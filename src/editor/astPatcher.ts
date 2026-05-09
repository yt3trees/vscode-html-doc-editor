import * as parse5 from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Document = DefaultTreeAdapterMap['document'];
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type TextNode = DefaultTreeAdapterMap['textNode'];
type Attribute = { name: string; value: string };

export type NodePath = number[];

export function parseHtml(source: string): Document {
  return parse5.parse(source, { sourceCodeLocationInfo: true }) as Document;
}

function getChildElements(node: Node): Node[] {
  if ('childNodes' in node) {
    return (node as Element).childNodes as Node[];
  }
  return [];
}

function resolveNode(doc: Document, path: NodePath): Node | null {
  let current: Node = doc;
  for (const idx of path) {
    const children = getChildElements(current);
    if (idx >= children.length) {
      return null;
    }
    current = children[idx];
  }
  return current;
}

function getLocation(node: Node) {
  return (node as unknown as { sourceCodeLocation?: parse5.Token.ElementLocation }).sourceCodeLocation;
}

export function applySetStyle(source: string, doc: Document, path: NodePath, prop: string, value: string): string {
  const node = resolveNode(doc, path);
  if (!node || node.nodeName === '#text' || node.nodeName === '#document') {
    return source;
  }
  const el = node as Element;
  const loc = getLocation(el);
  if (!loc || !loc.startTag) {
    return source;
  }

  const attrIdx = el.attrs.findIndex((a) => a.name === 'style');

  if (value === '' && attrIdx === -1) {
    return source;
  }

  let newStyleValue: string;
  if (attrIdx !== -1) {
    const existing = el.attrs[attrIdx].value;
    newStyleValue = setStyleProp(existing, prop, value);
  } else {
    newStyleValue = value ? `${prop}: ${value};` : '';
  }

  const startTagLoc = loc.startTag!;
  const tagSource = source.slice(startTagLoc.startOffset, startTagLoc.endOffset);

  const attrLocMap = (startTagLoc as unknown as { attrs?: Record<string, parse5.Token.Location> }).attrs ?? {};
  const attrLoc = attrLocMap['style'];

  if (attrLoc) {
    // Replace existing style attribute value only
    const attrStart = startTagLoc.startOffset + (attrLoc.startOffset - startTagLoc.startOffset);
    const attrEnd = startTagLoc.startOffset + (attrLoc.endOffset - startTagLoc.startOffset);

    if (newStyleValue === '') {
      // Remove the attribute entirely (include leading space)
      const before = source.slice(0, attrStart);
      const after = source.slice(attrEnd);
      return before.trimEnd() + after;
    }

    const valueStart = source.indexOf('"', attrStart);
    const valueEnd = source.indexOf('"', valueStart + 1);
    if (valueStart === -1 || valueEnd === -1) {
      return source;
    }
    return source.slice(0, valueStart + 1) + newStyleValue + source.slice(valueEnd);
  } else {
    // Insert new style attribute before the closing > of start tag
    const insertPos = findTagClose(tagSource) + startTagLoc.startOffset;
    const insertion = ` style="${newStyleValue}"`;
    return source.slice(0, insertPos) + insertion + source.slice(insertPos);
  }
}

export function applySetText(source: string, doc: Document, path: NodePath, text: string): string {
  const node = resolveNode(doc, path);
  if (!node) {
    return source;
  }

  // If element node, find first text child
  let textNode: TextNode | null = null;
  if (node.nodeName === '#text') {
    textNode = node as TextNode;
  } else {
    const children = getChildElements(node);
    const found = children.find((c) => c.nodeName === '#text');
    if (found) {
      textNode = found as TextNode;
    }
  }

  if (!textNode) {
    return source;
  }

  const loc = getLocation(textNode);
  if (!loc) {
    return source;
  }

  return source.slice(0, loc.startOffset) + escapeHtml(text) + source.slice(loc.endOffset);
}

export function applySetInnerHtml(source: string, doc: Document, path: NodePath, html: string): string {
  const node = resolveNode(doc, path);
  if (!node || node.nodeName === '#text' || node.nodeName === '#document') {
    return source;
  }
  const loc = getLocation(node as unknown as Node);
  if (!loc || !loc.startTag || !loc.endTag) {
    return source;
  }
  return source.slice(0, loc.startTag.endOffset) + html + source.slice(loc.endTag.startOffset);
}

export function applyRemoveElement(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node) {
    return source;
  }
  const loc = getLocation(node);
  if (!loc) {
    return source;
  }

  let start = loc.startOffset;
  let end = loc.endOffset;

  // Also consume preceding whitespace on the same line to avoid blank lines
  while (start > 0 && source[start - 1] === ' ') {
    start--;
  }
  if (start > 0 && source[start - 1] === '\n') {
    // consume the newline too only if the line would become empty
    const lineStart = start;
    let lineEnd = end;
    while (lineEnd < source.length && source[lineEnd] !== '\n') {
      lineEnd++;
    }
    const lineContent = source.slice(lineStart, lineEnd).trim();
    if (lineContent === '') {
      start--;
      end = lineEnd;
    }
  }

  return source.slice(0, start) + source.slice(end);
}

export function applyMoveElement(
  source: string,
  doc: Document,
  fromPath: NodePath,
  toPath: NodePath,
  position: 'before' | 'after' | 'inside'
): string {
  const fromNode = resolveNode(doc, fromPath);
  const toNode = resolveNode(doc, toPath);
  if (!fromNode || !toNode || fromNode === toNode) { return source; }

  const fromLoc = getLocation(fromNode);
  const toLoc = getLocation(toNode);
  if (!fromLoc || !toLoc) { return source; }

  // Extract the snippet to move
  const snippet = source.slice(fromLoc.startOffset, fromLoc.endOffset);

  // Detect indentation of from-element's line
  const indent = lineIndent(source, fromLoc.startOffset);

  // Remove the from element, consuming surrounding blank line if any
  let removeStart = fromLoc.startOffset;
  let removeEnd = fromLoc.endOffset;
  // Eat leading whitespace on the line
  while (removeStart > 0 && source[removeStart - 1] === ' ') { removeStart--; }
  // Eat the preceding newline if the line is now empty
  if (removeStart > 0 && source[removeStart - 1] === '\n') {
    let lineEnd = removeEnd;
    while (lineEnd < source.length && source[lineEnd] !== '\n') { lineEnd++; }
    if (source.slice(removeStart, lineEnd).trim() === '') {
      removeStart--;
      removeEnd = lineEnd;
    }
  }

  const afterRemove = source.slice(0, removeStart) + source.slice(removeEnd);

  // Adjust toPath if from came before to in the same parent (removal shifted indices)
  const adjustedToPath = adjustPath(fromPath, toPath);

  // Re-parse to get fresh locations after removal
  const doc2 = parseHtml(afterRemove);
  const toNode2 = resolveNode(doc2, adjustedToPath);
  if (!toNode2) { return source; }
  const toLoc2 = getLocation(toNode2);
  if (!toLoc2) { return source; }

  const toIndent = lineIndent(afterRemove, toLoc2.startOffset);

  if (position === 'before') {
    const ins = toLoc2.startOffset;
    return afterRemove.slice(0, ins) + snippet + '\n' + toIndent + afterRemove.slice(ins);
  } else if (position === 'after') {
    const ins = toLoc2.endOffset;
    return afterRemove.slice(0, ins) + '\n' + toIndent + snippet + afterRemove.slice(ins);
  } else {
    // 'inside': append as last child before closing tag
    const endTag = toLoc2.endTag;
    if (!endTag) { return source; }
    const ins = endTag.startOffset;
    const childIndent = toIndent + '  ';
    // Find start of the line containing the closing tag
    let lineStart = ins;
    while (lineStart > 0 && afterRemove[lineStart - 1] !== '\n') { lineStart--; }
    const linePrefix = afterRemove.slice(lineStart, ins);
    if (linePrefix.trim() === '') {
      // Closing tag on its own line — insert before it
      return afterRemove.slice(0, lineStart) + childIndent + snippet + '\n' + afterRemove.slice(lineStart);
    } else {
      return afterRemove.slice(0, ins) + '\n' + childIndent + snippet + '\n' + toIndent + afterRemove.slice(ins);
    }
  }
}

function adjustPath(removedPath: NodePath, targetPath: NodePath): NodePath {
  if (removedPath.length === 0 || targetPath.length === 0) { return targetPath; }
  // Check if same parent (all but last index match)
  if (removedPath.length !== targetPath.length) { return targetPath; }
  const parentSame = removedPath.slice(0, -1).every((v, i) => v === targetPath[i]);
  if (!parentSame) { return targetPath; }
  const ri = removedPath[removedPath.length - 1];
  const ti = targetPath[targetPath.length - 1];
  if (ri < ti) {
    return [...targetPath.slice(0, -1), ti - 1];
  }
  return targetPath;
}

function lineIndent(source: string, offset: number): string {
  let s = offset - 1;
  while (s >= 0 && source[s] !== '\n') { s--; }
  s++;
  let indent = '';
  while (s + indent.length < offset && /[ \t]/.test(source[s + indent.length])) {
    indent += source[s + indent.length];
  }
  return indent;
}

export function applyInsertElement(
  source: string,
  doc: Document,
  refPath: NodePath | null,
  position: 'after' | 'append',
  html: string
): string {
  if (!refPath || position === 'append') {
    const bodyEl = findBodyElement(doc);
    if (!bodyEl) { return source; }
    const loc = getLocation(bodyEl as unknown as Node);
    if (!loc || !loc.endTag) { return source; }
    const ins = loc.endTag.startOffset;
    return source.slice(0, ins) + '\n  ' + html + '\n' + source.slice(ins);
  }

  const node = resolveNode(doc, refPath);
  if (!node) { return source; }
  const loc = getLocation(node);
  if (!loc) { return source; }
  const indent = lineIndent(source, loc.startOffset);
  const ins = loc.endOffset;
  return source.slice(0, ins) + '\n' + indent + html + source.slice(ins);
}

function findBodyElement(doc: Document): Element | null {
  const htmlChildren = getChildElements(doc as unknown as Node);
  for (const node of htmlChildren) {
    if (node.nodeName === 'html') {
      for (const child of getChildElements(node)) {
        if (child.nodeName === 'body') { return child as Element; }
      }
    }
  }
  return null;
}

export function applyDuplicateElement(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node) {
    return source;
  }
  const loc = getLocation(node);
  if (!loc) {
    return source;
  }
  const snippet = source.slice(loc.startOffset, loc.endOffset);
  return source.slice(0, loc.endOffset) + '\n' + snippet + source.slice(loc.endOffset);
}

// ---- table operations ----

function getAttr(el: Element, name: string): string {
  return el.attrs.find((a) => a.name === name)?.value ?? '';
}

function setAttrSource(source: string, el: Element, name: string, value: string): string {
  const loc = getLocation(el);
  if (!loc || !loc.startTag) { return source; }
  const startTagLoc = loc.startTag;
  const attrLocMap = (startTagLoc as unknown as { attrs?: Record<string, parse5.Token.Location> }).attrs ?? {};
  const attrLoc = attrLocMap[name];
  if (attrLoc) {
    const valueStart = source.indexOf('"', attrLoc.startOffset);
    const valueEnd = source.indexOf('"', valueStart + 1);
    if (valueStart === -1 || valueEnd === -1) { return source; }
    return source.slice(0, valueStart + 1) + value + source.slice(valueEnd);
  } else {
    const tagSource = source.slice(startTagLoc.startOffset, startTagLoc.endOffset);
    const insertPos = findTagClose(tagSource) + startTagLoc.startOffset;
    return source.slice(0, insertPos) + ` ${name}="${value}"` + source.slice(insertPos);
  }
}

function removeAttrSource(source: string, el: Element, name: string): string {
  const loc = getLocation(el);
  if (!loc || !loc.startTag) { return source; }
  const startTagLoc = loc.startTag;
  const attrLocMap = (startTagLoc as unknown as { attrs?: Record<string, parse5.Token.Location> }).attrs ?? {};
  const attrLoc = attrLocMap[name];
  if (!attrLoc) { return source; }
  const before = source.slice(0, attrLoc.startOffset).trimEnd();
  return before + source.slice(attrLoc.endOffset);
}

function getRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of getChildElements(table)) {
    if (child.nodeName === 'thead' || child.nodeName === 'tbody' || child.nodeName === 'tfoot') {
      for (const row of getChildElements(child)) {
        if (row.nodeName === 'tr') { rows.push(row as Element); }
      }
    } else if (child.nodeName === 'tr') {
      rows.push(child as Element);
    }
  }
  return rows;
}

function getCellsInRow(tr: Element): Element[] {
  return getChildElements(tr).filter((n) => n.nodeName === 'td' || n.nodeName === 'th') as Element[];
}

function cellColumnIndex(tr: Element, cell: Element): number {
  let col = 0;
  for (const c of getCellsInRow(tr)) {
    if (c === cell) { return col; }
    col += parseInt(getAttr(c, 'colspan') || '1', 10);
  }
  return -1;
}

function findEnclosingNode(doc: Document, path: NodePath, tagName: string): { node: Element; path: NodePath } | null {
  for (let len = path.length - 1; len >= 0; len--) {
    const p = path.slice(0, len);
    const n = resolveNode(doc, p);
    if (n && n.nodeName === tagName) { return { node: n as Element, path: p }; }
  }
  return null;
}

function findNodePath(doc: Document, target: Node): NodePath | null {
  function walk(node: Node, path: NodePath): NodePath | null {
    if (node === target) { return path; }
    const children = getChildElements(node);
    for (let i = 0; i < children.length; i++) {
      const r = walk(children[i], [...path, i]);
      if (r) { return r; }
    }
    return null;
  }
  return walk(doc as unknown as Node, []);
}

export function applyInsertRow(source: string, doc: Document, path: NodePath, position: 'before' | 'after'): string {
  // path may point to a tr or a cell inside a tr
  let trNode: Element | null = null;
  let trPath: NodePath = path;
  const node = resolveNode(doc, path);
  if (!node) { return source; }
  if (node.nodeName === 'tr') {
    trNode = node as Element;
  } else {
    const found = findEnclosingNode(doc, path, 'tr');
    if (!found) { return source; }
    trNode = found.node;
    trPath = found.path;
  }

  const loc = getLocation(trNode);
  if (!loc) { return source; }

  const cells = getCellsInRow(trNode);
  const indent = lineIndent(source, loc.startOffset);

  // Copy cell structure and styles from reference row
  const cellsHtml = cells.map((c) => {
    const style = getAttr(c, 'style');
    const styleAttr = style ? ` style="${style}"` : '';
    const colspan = getAttr(c, 'colspan');
    const colspanAttr = colspan && colspan !== '1' ? ` colspan="${colspan}"` : '';
    return `<${c.nodeName}${styleAttr}${colspanAttr}></${c.nodeName}>`;
  }).join('');
  const trStyle = getAttr(trNode, 'style');
  const trStyleAttr = trStyle ? ` style="${trStyle}"` : '';
  const newRow = cells.length > 0
    ? `<tr${trStyleAttr}>${cellsHtml}</tr>`
    : `<tr${trStyleAttr}><td></td></tr>`;

  if (position === 'before') {
    return source.slice(0, loc.startOffset) + newRow + '\n' + indent + source.slice(loc.startOffset);
  } else {
    return source.slice(0, loc.endOffset) + '\n' + indent + newRow + source.slice(loc.endOffset);
  }
}

export function applyInsertColumn(source: string, doc: Document, path: NodePath, position: 'before' | 'after'): string {
  const node = resolveNode(doc, path);
  if (!node || (node.nodeName !== 'td' && node.nodeName !== 'th')) { return source; }
  const cell = node as Element;
  const colspan = parseInt(getAttr(cell, 'colspan') || '1', 10);

  const trInfo = findEnclosingNode(doc, path, 'tr');
  if (!trInfo) { return source; }
  const trNode = trInfo.node;

  const colIdx = cellColumnIndex(trNode, cell);
  if (colIdx < 0) { return source; }

  const insertBeforeLogicalCol = position === 'before' ? colIdx : colIdx + colspan;

  const tableInfo = findEnclosingNode(doc, trInfo.path, 'table');
  if (!tableInfo) { return source; }

  const rows = getRows(tableInfo.node);
  const insertions: Array<{ offset: number; html: string }> = [];

  for (const row of rows) {
    const rowCells = getCellsInRow(row);
    const allThRow = rowCells.length > 0 && rowCells.every((c) => c.nodeName === 'th');
    const cellTag = allThRow ? 'th' : 'td';
    let col = 0;
    let insertOffset: number | null = null;
    let spanned = false;
    let refCell: Element | null = null;

    for (const c of rowCells) {
      const cs = parseInt(getAttr(c, 'colspan') || '1', 10);
      if (col < insertBeforeLogicalCol && col + cs > insertBeforeLogicalCol) {
        spanned = true;
        break;
      }
      if (col >= insertBeforeLogicalCol) {
        const cLoc = getLocation(c);
        if (cLoc) { insertOffset = cLoc.startOffset; }
        refCell = c;
        break;
      }
      refCell = c;
      col += cs;
    }

    if (!spanned && insertOffset === null) {
      const rowLoc = getLocation(row);
      if (rowLoc && rowLoc.endTag) { insertOffset = rowLoc.endTag.startOffset; }
    }

    if (!spanned && insertOffset !== null) {
      const refStyle = refCell ? getAttr(refCell, 'style') : '';
      const styleAttr = refStyle ? ` style="${refStyle}"` : '';
      insertions.push({ offset: insertOffset, html: `<${cellTag}${styleAttr}></${cellTag}>` });
    }
  }

  insertions.sort((a, b) => b.offset - a.offset);
  for (const ins of insertions) {
    source = source.slice(0, ins.offset) + ins.html + source.slice(ins.offset);
  }
  return source;
}

export function applyRemoveRow(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node) { return source; }
  let trPath = path;
  if (node.nodeName !== 'tr') {
    const found = findEnclosingNode(doc, path, 'tr');
    if (!found) { return source; }
    trPath = found.path;
  }

  const tableInfo = findEnclosingNode(doc, trPath, 'table');
  if (tableInfo && getRows(tableInfo.node).length === 1) {
    return applyRemoveElement(source, doc, tableInfo.path);
  }
  return applyRemoveElement(source, doc, trPath);
}

export function applyRemoveColumn(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node || (node.nodeName !== 'td' && node.nodeName !== 'th')) { return source; }
  const cell = node as Element;

  const trInfo = findEnclosingNode(doc, path, 'tr');
  if (!trInfo) { return source; }

  const colIdx = cellColumnIndex(trInfo.node, cell);
  if (colIdx < 0) { return source; }

  const tableInfo = findEnclosingNode(doc, trInfo.path, 'table');
  if (!tableInfo) { return source; }

  const rows = getRows(tableInfo.node);
  const isLastCol = rows.every((row) => {
    const cells = getCellsInRow(row);
    return cells.reduce((sum, c) => sum + parseInt(getAttr(c, 'colspan') || '1', 10), 0) <= 1;
  });
  if (isLastCol) { return source; }

  const removals: Array<{ start: number; end: number }> = [];

  for (const row of rows) {
    let col = 0;
    for (const c of getCellsInRow(row)) {
      const cs = parseInt(getAttr(c, 'colspan') || '1', 10);
      if (col === colIdx) {
        const cLoc = getLocation(c);
        if (cLoc) { removals.push({ start: cLoc.startOffset, end: cLoc.endOffset }); }
        break;
      } else if (col < colIdx && col + cs > colIdx) {
        break;
      }
      col += cs;
    }
  }

  removals.sort((a, b) => b.start - a.start);
  for (const rem of removals) {
    let start = rem.start;
    while (start > 0 && source[start - 1] === ' ') { start--; }
    source = source.slice(0, start) + source.slice(rem.end);
  }
  return source;
}

export function applyMergeCellRight(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node || (node.nodeName !== 'td' && node.nodeName !== 'th')) { return source; }
  const cell = node as Element;

  const trInfo = findEnclosingNode(doc, path, 'tr');
  if (!trInfo) { return source; }

  const rowCells = getCellsInRow(trInfo.node);
  const cellIdx = rowCells.indexOf(cell);
  if (cellIdx === -1 || cellIdx === rowCells.length - 1) { return source; }

  const rightCell = rowCells[cellIdx + 1];
  const currentRowspan = parseInt(getAttr(cell, 'rowspan') || '1', 10);
  const rightRowspan = parseInt(getAttr(rightCell, 'rowspan') || '1', 10);
  if (currentRowspan !== rightRowspan) { return source; }

  const currentColspan = parseInt(getAttr(cell, 'colspan') || '1', 10);
  const rightColspan = parseInt(getAttr(rightCell, 'colspan') || '1', 10);

  const rightCellPath = findNodePath(doc, rightCell as unknown as Node);
  if (!rightCellPath) { return source; }

  // Remove right cell first (higher offset), then re-parse and update colspan
  let newSource = applyRemoveElement(source, doc, rightCellPath);
  const doc2 = parseHtml(newSource);
  const cell2 = resolveNode(doc2, path);
  if (!cell2 || (cell2.nodeName !== 'td' && cell2.nodeName !== 'th')) { return newSource; }
  newSource = setAttrSource(newSource, cell2 as Element, 'colspan', String(currentColspan + rightColspan));
  return newSource;
}

export function applyMergeCellDown(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node || (node.nodeName !== 'td' && node.nodeName !== 'th')) { return source; }
  const cell = node as Element;

  const trInfo = findEnclosingNode(doc, path, 'tr');
  if (!trInfo) { return source; }

  const tableInfo = findEnclosingNode(doc, trInfo.path, 'table');
  if (!tableInfo) { return source; }

  const rows = getRows(tableInfo.node);
  const rowIdx = rows.indexOf(trInfo.node);
  if (rowIdx === -1 || rowIdx === rows.length - 1) { return source; }

  const colIdx = cellColumnIndex(trInfo.node, cell);
  if (colIdx < 0) { return source; }

  const currentColspan = parseInt(getAttr(cell, 'colspan') || '1', 10);
  const currentRowspan = parseInt(getAttr(cell, 'rowspan') || '1', 10);

  const nextRow = rows[rowIdx + 1];
  let col = 0;
  let targetCell: Element | null = null;
  for (const c of getCellsInRow(nextRow)) {
    if (col === colIdx) { targetCell = c; break; }
    col += parseInt(getAttr(c, 'colspan') || '1', 10);
  }
  if (!targetCell) { return source; }
  if (parseInt(getAttr(targetCell, 'colspan') || '1', 10) !== currentColspan) { return source; }

  const targetCellPath = findNodePath(doc, targetCell as unknown as Node);
  if (!targetCellPath) { return source; }

  // Remove target cell first, then re-parse and update rowspan
  let newSource = applyRemoveElement(source, doc, targetCellPath);
  const doc2 = parseHtml(newSource);
  const cell2 = resolveNode(doc2, path);
  if (!cell2 || (cell2.nodeName !== 'td' && cell2.nodeName !== 'th')) { return newSource; }
  newSource = setAttrSource(newSource, cell2 as Element, 'rowspan', String(currentRowspan + 1));
  return newSource;
}

export function applySplitCell(source: string, doc: Document, path: NodePath): string {
  const node = resolveNode(doc, path);
  if (!node || (node.nodeName !== 'td' && node.nodeName !== 'th')) { return source; }
  const cell = node as Element;

  const colspan = parseInt(getAttr(cell, 'colspan') || '1', 10);
  const rowspan = parseInt(getAttr(cell, 'rowspan') || '1', 10);
  if (colspan === 1 && rowspan === 1) { return source; }

  const trInfo = findEnclosingNode(doc, path, 'tr');
  if (!trInfo) { return source; }
  const colIdx = cellColumnIndex(trInfo.node, cell);

  let newSource = source;

  // Handle colspan: remove attribute and insert (colspan-1) cells after current cell
  if (colspan > 1) {
    let doc2 = parseHtml(newSource);
    let cell2 = resolveNode(doc2, path);
    if (cell2 && (cell2.nodeName === 'td' || cell2.nodeName === 'th')) {
      newSource = removeAttrSource(newSource, cell2 as Element, 'colspan');
    }
    doc2 = parseHtml(newSource);
    cell2 = resolveNode(doc2, path);
    if (cell2) {
      const loc = getLocation(cell2);
      if (loc) {
        const cellTag = (cell2 as Element).nodeName;
        const extraCells = Array.from({ length: colspan - 1 }, () => `<${cellTag}></${cellTag}>`).join('');
        newSource = newSource.slice(0, loc.endOffset) + extraCells + newSource.slice(loc.endOffset);
      }
    }
  }

  // Handle rowspan: remove attribute and insert cells in subsequent rows
  if (rowspan > 1) {
    let doc3 = parseHtml(newSource);
    const cell3 = resolveNode(doc3, path);
    if (cell3 && (cell3.nodeName === 'td' || cell3.nodeName === 'th')) {
      newSource = removeAttrSource(newSource, cell3 as Element, 'rowspan');
    }
    doc3 = parseHtml(newSource);
    const trInfo3 = findEnclosingNode(doc3, path, 'tr');
    const tableInfo3 = trInfo3 ? findEnclosingNode(doc3, trInfo3.path, 'table') : null;
    if (trInfo3 && tableInfo3) {
      const rows3 = getRows(tableInfo3.node);
      const rowIdx = rows3.indexOf(trInfo3.node);
      if (rowIdx >= 0) {
        const targetRows = rows3.slice(rowIdx + 1, rowIdx + rowspan);
        const insertions: Array<{ offset: number; html: string }> = [];
        for (const row of targetRows) {
          const rowCells = getCellsInRow(row);
          const allThRow = rowCells.length > 0 && rowCells.every((c) => c.nodeName === 'th');
          const cellTag = allThRow ? 'th' : 'td';
          let col = 0;
          let insertOffset: number | null = null;
          for (const c of rowCells) {
            const cs = parseInt(getAttr(c, 'colspan') || '1', 10);
            if (col >= colIdx) {
              const cLoc = getLocation(c);
              if (cLoc) { insertOffset = cLoc.startOffset; }
              break;
            }
            col += cs;
          }
          if (insertOffset === null) {
            const rowLoc = getLocation(row);
            if (rowLoc && rowLoc.endTag) { insertOffset = rowLoc.endTag.startOffset; }
          }
          if (insertOffset !== null) {
            const extraCells = Array.from({ length: colspan }, () => `<${cellTag}></${cellTag}>`).join('');
            insertions.push({ offset: insertOffset, html: extraCells });
          }
        }
        insertions.sort((a, b) => b.offset - a.offset);
        for (const ins of insertions) {
          newSource = newSource.slice(0, ins.offset) + ins.html + newSource.slice(ins.offset);
        }
      }
    }
  }

  return newSource;
}

// ---- helpers ----

function setStyleProp(style: string, prop: string, value: string): string {
  const decls = parseStyleDecls(style);
  const normalized = prop.toLowerCase();
  const idx = decls.findIndex((d) => d.prop.toLowerCase() === normalized);
  if (value === '') {
    if (idx !== -1) {
      decls.splice(idx, 1);
    }
  } else if (idx !== -1) {
    decls[idx].value = value;
  } else {
    decls.push({ prop, value });
  }
  return decls.map((d) => `${d.prop}: ${d.value}`).join('; ') + (decls.length ? ';' : '');
}

function parseStyleDecls(style: string): { prop: string; value: string }[] {
  return style
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const colon = s.indexOf(':');
      return colon !== -1
        ? { prop: s.slice(0, colon).trim(), value: s.slice(colon + 1).trim() }
        : { prop: s, value: '' };
    });
}

function findTagClose(tagSource: string): number {
  // Find the position of > (not inside attribute values)
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < tagSource.length; i++) {
    const c = tagSource[i];
    if (inQuote) {
      if (c === quoteChar) {
        inQuote = false;
      }
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
    } else if (c === '>') {
      return i;
    }
  }
  return tagSource.length - 1;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
