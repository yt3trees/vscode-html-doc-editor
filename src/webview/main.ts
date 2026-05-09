import { Inspector } from './inspector';
import { Outline } from './outline';
import { SelectionOverlay } from './overlay';
import { AddPanel } from './addPanel';
import type { HostMessage, WebviewMessage, NodePath } from './types';

declare const acquireVsCodeApi: () => {
  postMessage(msg: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();

const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
const previewArea = document.getElementById('preview-area') as HTMLElement;
const outlineEl = document.getElementById('outline') as HTMLElement;
const inspectorEl = document.getElementById('inspector') as HTMLElement;
const addPanelEl = document.getElementById('add-panel') as HTMLElement;

let currentPath: NodePath | null = null;
let currentEl: HTMLElement | null = null;

let editingEl: HTMLElement | null = null;
let editingPath: NodePath | null = null;
let editingSnapshot: string = '';
let editingHasMixed: boolean = false;
let isComposing: boolean = false;
let pendingHtml: string | null = null;

const commitStyle = (prop: string, value: string) => {
  if (currentPath) {
    vscode.postMessage({ type: 'setStyle', path: currentPath, prop, value });
  }
};

const liveStyle = (prop: string, value: string) => {
  if (currentEl) {
    currentEl.style.setProperty(prop, value);
    overlay.update();
  }
};

const inspector = new Inspector(
  inspectorEl,
  commitStyle,
  liveStyle,
  (text) => {
    if (currentPath) {
      vscode.postMessage({ type: 'setText', path: currentPath, text });
    }
  },
  () => {
    if (currentPath) {
      vscode.postMessage({ type: 'removeElement', path: currentPath });
      currentPath = null;
      currentEl = null;
      inspector.clear();
      overlay.hide();
    }
  },
  () => {
    if (currentPath) {
      vscode.postMessage({ type: 'duplicateElement', path: currentPath });
    }
  }
);

const outline = new Outline(outlineEl, (path) => {
  currentPath = path;
  outline.highlight(path);
  const doc = iframe.contentDocument;
  if (doc) {
    const el = resolveElementByPath(doc, path);
    if (el) {
      selectElement(el as HTMLElement);
    }
  }
});

const overlay = new SelectionOverlay(
  previewArea,
  (prop, value) => {
    commitStyle(prop, value);
    if (currentEl) {
      const style = parseInlineStyle(currentEl.style.cssText);
      if (currentPath) {
        inspector.show({
          path: currentPath,
          tagName: currentEl.tagName.toLowerCase(),
          style,
          textContent: currentEl.textContent ?? '',
        });
      }
    }
  },
  (fromPath, refPath, position) => {
    vscode.postMessage({ type: 'moveElement', fromPath, toPath: refPath, position });
  },
  (el) => getNodePath(el)
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const addPanel = new AddPanel(addPanelEl, (html) => {
  vscode.postMessage({
    type: 'insertElement',
    refPath: currentPath,
    position: currentPath ? 'after' : 'append',
    html,
  });
});

inspector.clear();

// ---- hover highlight ----

let hoveredEl: HTMLElement | null = null;

function setHover(el: HTMLElement | null): void {
  if (el === hoveredEl) { return; }
  if (hoveredEl) { hoveredEl.removeAttribute('data-edit-hover'); }
  hoveredEl = el;
  if (el) { el.setAttribute('data-edit-hover', '1'); }
}

// ---- DOM helpers ----

function getNodePath(node: Node): NodePath {
  const path: number[] = [];
  let current: Node = node;
  while (current.parentNode) {
    const parent = current.parentNode;
    const idx = Array.from(parent.childNodes).indexOf(current as ChildNode);
    path.unshift(idx);
    current = parent;
    if (current.nodeType === Node.DOCUMENT_NODE) {
      break;
    }
  }
  return path;
}

function resolveElementByPath(doc: Document, path: NodePath): Element | null {
  let current: Node = doc;
  for (const idx of path) {
    if (!current.childNodes || idx >= current.childNodes.length) {
      return null;
    }
    current = current.childNodes[idx];
  }
  return current instanceof Element ? current : null;
}

function parseInlineStyle(cssText: string): Record<string, string> {
  const result: Record<string, string> = {};
  cssText.split(';').forEach((decl) => {
    const colon = decl.indexOf(':');
    if (colon === -1) { return; }
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (prop) { result[prop] = value; }
  });
  return result;
}

const COMPUTED_PROPS = [
  'font-family', 'font-size', 'font-weight', 'color', 'line-height',
  'letter-spacing', 'text-align',
  'width', 'height', 'min-width', 'min-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'background-color', 'border', 'border-radius', 'opacity',
  'position', 'top', 'right', 'bottom', 'left',
];

function getElementStyle(el: HTMLElement): Record<string, string> {
  const result = parseInlineStyle(el.style.cssText);
  try {
    const cs = iframe.contentWindow!.getComputedStyle(el);
    for (const prop of COMPUTED_PROPS) {
      if (!result[prop]) {
        const val = cs.getPropertyValue(prop).trim();
        if (val) { result[prop] = val; }
      }
    }
  } catch { /* ignore */ }
  return result;
}

function selectElement(el: HTMLElement): void {
  setHover(null);
  currentEl = el;
  const doc = iframe.contentDocument!;

  doc.querySelectorAll('[data-edit-sel]').forEach((prev) => {
    (prev as HTMLElement).removeAttribute('data-edit-sel');
  });
  el.setAttribute('data-edit-sel', '1');
  el.scrollIntoView({ block: 'nearest' });

  overlay.show(el, iframe, currentPath!);

  inspector.show({
    path: currentPath!,
    tagName: el.tagName.toLowerCase(),
    style: getElementStyle(el),
    textContent: el.textContent ?? '',
  });
}

// ---- inline editing ----

function enterEditMode(el: HTMLElement): void {
  if (editingEl) {
    exitEditMode(true);
  }
  // Ignore void elements (no endTag in source)
  const tag = el.tagName.toLowerCase();
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  if (voidTags.has(tag)) { return; }

  editingEl = el;
  editingPath = currentPath;
  editingSnapshot = el.innerHTML;
  editingHasMixed = el.children.length > 0;

  el.setAttribute('contenteditable', 'true');
  el.focus();
}

function exitEditMode(commit: boolean): void {
  if (!editingEl) { return; }
  const el = editingEl;
  const path = editingPath;
  const hasMixed = editingHasMixed;

  el.removeAttribute('contenteditable');
  editingEl = null;
  editingPath = null;

  if (commit && path) {
    if (hasMixed) {
      vscode.postMessage({ type: 'setInnerHtml', path, html: el.innerHTML });
    } else {
      vscode.postMessage({ type: 'setText', path, text: el.textContent ?? '' });
    }
  } else {
    el.innerHTML = editingSnapshot;
  }

  // Flush any deferred update that arrived while editing
  if (pendingHtml !== null) {
    const html = pendingHtml;
    pendingHtml = null;
    loadHtml(html);
  }
}

// ---- keyboard ----

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && editingEl) {
    e.preventDefault();
    exitEditMode(false);
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) { return; }
  const target = e.target as HTMLElement;
  const inInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || (target as HTMLElement).isContentEditable;
  if (e.key === 's') {
    e.preventDefault();
    if (editingEl) { exitEditMode(true); }
    vscode.postMessage({ type: 'save' });
  } else if (e.key === 'z' && !e.shiftKey && !inInput) {
    e.preventDefault();
    vscode.postMessage({ type: 'undo' });
  } else if ((e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !inInput) {
    e.preventDefault();
    vscode.postMessage({ type: 'redo' });
  }
}

document.addEventListener('keydown', handleKeydown);

// ---- iframe loading ----

function attachIframeListeners(): void {
  const doc = iframe.contentDocument;
  inspectorEl.innerHTML = `<p style="padding:12px;color:yellow;">DBG attach: doc=${doc ? 'ok' : 'null'}</p>`;
  if (!doc) {
    return;
  }

  // Clear stale hover reference from previous load
  hoveredEl = null;

  doc.addEventListener('keydown', handleKeydown as EventListener);

  doc.addEventListener('click', (e) => {
    const target = e.target as Element;
    // Inside contenteditable — let browser handle caret
    if (editingEl && editingEl.contains(target)) {
      return;
    }
    e.preventDefault();
    inspectorEl.innerHTML = `<p style="padding:12px;color:lime;">DBG click: ${target?.tagName ?? 'null'}</p>`;
    if (!target || target === doc.documentElement || target === doc.body) {
      return;
    }
    const path = getNodePath(target);
    currentPath = path;
    outline.highlight(path);
    vscode.postMessage({ type: 'selectElement', path });
    try {
      selectElement(target as HTMLElement);
    } catch (err) {
      inspectorEl.innerHTML = `<p style="padding:12px;color:red;">DBG error: ${err}</p>`;
    }
  }, { capture: true });

  doc.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    if (!target || target === doc.documentElement || target === doc.body) { return; }
    e.preventDefault();
    // Ensure selection is up to date first
    const path = getNodePath(target);
    currentPath = path;
    currentEl = target;
    enterEditMode(target);
  }, { capture: true });

  doc.addEventListener('compositionstart', () => { isComposing = true; }, true);
  doc.addEventListener('compositionend', () => { isComposing = false; }, true);

  doc.addEventListener('focusout', (e) => {
    const target = e.target as HTMLElement;
    if (!editingEl || target !== editingEl) { return; }
    if (isComposing) { return; }
    exitEditMode(true);
  }, true);

  doc.addEventListener('scroll', () => overlay.update(), true);

  // Inject hover highlight CSS into iframe
  const hoverStyle = doc.createElement('style');
  hoverStyle.textContent = '[data-edit-hover]{outline:1px solid rgba(74,144,217,0.5)!important;}[data-edit-sel]{outline:2px solid rgba(74,144,217,0.9)!important;}[contenteditable="true"]{outline:2px dashed rgba(255,200,0,0.9)!important;cursor:text;}';
  doc.head.appendChild(hoverStyle);

  // Hover highlight
  doc.addEventListener('mousemove', (e) => {
    if (editingEl) { setHover(null); return; }
    const target = e.target as HTMLElement;
    if (!target || target === doc.documentElement || target === doc.body) {
      setHover(null);
      return;
    }
    if (target.hasAttribute('data-edit-sel')) {
      setHover(null);
      return;
    }
    setHover(target);
  }, { capture: true });

  // Populate outline
  const headings = doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
  const items = Array.from(headings).map((h) => ({
    text: h.textContent?.trim() ?? '',
    level: parseInt(h.tagName[1], 10),
    path: getNodePath(h),
  }));
  outline.updateFromData(items);

  // Restore previous selection after reload
  if (currentPath) {
    const el = resolveElementByPath(doc, currentPath);
    if (el) {
      currentEl = el as HTMLElement;
      selectElement(el as HTMLElement);
    }
  }
}

window.addEventListener('resize', () => overlay.update());
iframe.addEventListener('mouseleave', () => setHover(null));

function loadHtml(html: string): void {
  iframe.addEventListener('load', () => {
    attachIframeListeners();
  }, { once: true });
  iframe.srcdoc = html;
}

// Messages from the VSCode extension host
window.addEventListener('message', (event) => {
  const msg = event.data as HostMessage;
  if (msg.type === 'update') {
    if (editingEl) {
      // Defer reload until editing is complete
      pendingHtml = msg.html;
    } else {
      loadHtml(msg.html);
    }
  } else if (msg.type === 'error') {
    console.error('[edit-html] host error:', msg.message);
  }
});

// ---- panel styles ----

const style = document.createElement('style');
style.textContent = `
  #preview-area { position: relative; }
  .section-header {
    font-weight: 600; padding: 8px 8px 4px; font-size: 11px;
    opacity: 0.7; text-transform: uppercase;
    border-bottom: 1px solid var(--vscode-editorGroup-border, #333);
    margin-bottom: 4px;
  }
  .section-label {
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    opacity: 0.5; padding: 10px 8px 4px; text-transform: uppercase;
  }
  .field-row {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; min-height: 24px;
  }
  .field-row.full { flex-direction: column; align-items: stretch; padding: 4px 8px; }
  .field-label { width: 72px; flex-shrink: 0; font-size: 11px; opacity: 0.7; }
  .field-input {
    flex: 1;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 2px 4px; font-size: 11px; border-radius: 2px; min-width: 0;
  }
  .color-row {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; min-height: 24px;
  }
  .color-row .field-label { width: 72px; flex-shrink: 0; font-size: 11px; opacity: 0.7; }
  .color-picker { width: 28px; height: 22px; padding: 2px; border-radius: 3px; cursor: pointer; flex-shrink: 0; border: 1px solid var(--vscode-input-border, #555); -webkit-appearance: none; appearance: none; background: none; }
  .color-hex {
    flex: 1; min-width: 0;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 2px 4px; font-size: 11px; border-radius: 2px; font-family: monospace;
  }
  textarea.field-input { resize: vertical; width: 100%; }
  .action-row {
    display: flex; gap: 6px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-editorGroup-border, #333);
  }
  .action-row button {
    flex: 1; padding: 4px 8px; font-size: 11px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid var(--vscode-button-border, #555);
    border-radius: 2px; cursor: pointer;
  }
  .action-row button.danger { color: #e57373; border-color: #e57373; }
  .action-row button:hover { opacity: 0.8; }
  .outline-item {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px; cursor: pointer; font-size: 11px;
    border-radius: 2px; margin: 1px 4px;
  }
  .outline-item:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }
  .outline-item.active { background: var(--vscode-list-activeSelectionBackground, rgba(74,144,217,0.2)); }
  .outline-level { font-size: 9px; opacity: 0.5; min-width: 16px; text-transform: uppercase; }
  .outline-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unit-badge {
    font-size: 9px; opacity: 0.55; padding: 1px 4px; cursor: pointer; flex-shrink: 0;
    border: 1px solid var(--vscode-input-border, #555); border-radius: 2px;
    user-select: none; font-family: monospace;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
  }
  .unit-badge:hover { opacity: 0.9; }
  .add-item {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px; cursor: pointer; font-size: 11px;
    border-radius: 2px; margin: 1px 4px;
  }
  .add-item:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }
  .add-tag {
    font-size: 9px; opacity: 0.5; min-width: 26px; text-align: center;
    border: 1px solid currentColor; border-radius: 2px; padding: 0 2px; flex-shrink: 0;
  }
`;
document.head.appendChild(style);

vscode.postMessage({ type: 'ready' });
