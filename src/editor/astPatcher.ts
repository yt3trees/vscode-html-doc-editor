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
