export type StyleCommit = (prop: string, value: string) => void;
export type MoveCommit = (fromPath: number[], toPath: number[], position: 'before' | 'after' | 'inside') => void;
export type PathResolver = (el: Element) => number[];

const HANDLE_SIZE = 8;
const HANDLE_HALF = HANDLE_SIZE / 2;

type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface ResizeDrag {
  kind: 'resize';
  dir: ResizeDir;
  startX: number; startY: number;
  startW: number; startH: number;
}

interface ReorderDrag {
  kind: 'reorder';
  startX: number; startY: number;
}

type DragState = ResizeDrag | ReorderDrag;

// Container elements that support 'inside' drops
const CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer',
  'nav', 'aside', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
]);

export class SelectionOverlay {
  private box: HTMLElement;
  private toolbar: HTMLElement;
  private marginEl: HTMLElement;
  private paddingEl: HTMLElement;
  private dropMarker: HTMLElement;      // horizontal line for before/after
  private dropInsideMarker: HTMLElement; // border for inside

  private el: HTMLElement | null = null;
  private currentPath: number[] | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private drag: DragState | null = null;

  private placeholder: HTMLElement | null = null;

  constructor(
    private previewArea: HTMLElement,
    private onStyleCommit: StyleCommit,
    private onMoveCommit: MoveCommit,
    private pathResolver: PathResolver
  ) {
    this.marginEl = mkDiv(`position:absolute;display:none;box-sizing:border-box;
      border:1px dashed rgba(255,160,0,0.6);background:rgba(255,160,0,0.06);pointer-events:none;z-index:98;`);
    this.paddingEl = mkDiv(`position:absolute;display:none;box-sizing:border-box;
      border:1px dashed rgba(0,180,80,0.6);background:rgba(0,180,80,0.06);pointer-events:none;z-index:98;`);
    this.dropMarker = mkDiv(`position:absolute;display:none;height:3px;background:#e040fb;
      left:0;right:0;z-index:200;pointer-events:none;border-radius:2px;`);
    this.dropInsideMarker = mkDiv(`position:absolute;display:none;box-sizing:border-box;
      border:2px dashed #e040fb;background:rgba(224,64,251,0.06);z-index:199;pointer-events:none;border-radius:2px;`);

    this.toolbar = mkDiv(`position:absolute;display:none;bottom:100%;left:0;
      display:none;align-items:center;gap:2px;padding:2px;pointer-events:all;`);

    const reorderBtn = mkDiv(`background:#4A90D9;color:#fff;font-size:11px;padding:2px 7px;
      border-radius:3px 3px 0 0;cursor:grab;user-select:none;white-space:nowrap;`);
    reorderBtn.textContent = '↕ Reorder';
    reorderBtn.addEventListener('mousedown', (e) => this.onReorderStart(e));
    this.toolbar.appendChild(reorderBtn);

    this.box = mkDiv(`position:absolute;display:none;box-sizing:border-box;
      border:2px solid #4A90D9;z-index:100;pointer-events:none;`);
    this.box.appendChild(this.toolbar);

    this.buildResizeHandles();

    previewArea.appendChild(this.marginEl);
    previewArea.appendChild(this.paddingEl);
    previewArea.appendChild(this.dropInsideMarker);
    previewArea.appendChild(this.dropMarker);
    previewArea.appendChild(this.box);

    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
  }

  // ---- public ----

  show(el: HTMLElement, iframeEl: HTMLIFrameElement, path: number[]): void {
    this.el = el;
    this.iframe = iframeEl;
    this.currentPath = path;
    this.box.style.display = 'block';
    this.toolbar.style.display = 'flex';
    this.marginEl.style.display = 'block';
    this.paddingEl.style.display = 'block';
    this.update();
  }

  hide(): void {
    this.el = null;
    this.box.style.display = 'none';
    this.toolbar.style.display = 'none';
    this.marginEl.style.display = 'none';
    this.paddingEl.style.display = 'none';
    this.dropMarker.style.display = 'none';
    this.dropInsideMarker.style.display = 'none';
  }

  update(): void {
    if (!this.el || !this.iframe) { return; }
    const p = this.elPos(this.el);
    if (!p) { return; }

    place(this.box, p.x, p.y, p.w, p.h);

    try {
      const cw = this.iframe.contentWindow!;
      const cs = cw.getComputedStyle(this.el);
      const mt = px(cs.marginTop), mr = px(cs.marginRight),
            mb = px(cs.marginBottom), ml = px(cs.marginLeft);
      const pt = px(cs.paddingTop), pr = px(cs.paddingRight),
            pb = px(cs.paddingBottom), pl = px(cs.paddingLeft);
      place(this.marginEl, p.x - ml, p.y - mt, p.w + ml + mr, p.h + mt + mb);
      place(this.paddingEl, p.x + pl, p.y + pt, p.w - pl - pr, p.h - pt - pb);
    } catch { /* cross-origin guard */ }
  }

  // ---- resize handles ----

  private buildResizeHandles(): void {
    const defs: { d: ResizeDir; t?: string; l?: string; r?: string; b?: string; cursor: string }[] = [
      { d: 'nw', t: `-${HANDLE_HALF}px`, l: `-${HANDLE_HALF}px`, cursor: 'nw-resize' },
      { d: 'n',  t: `-${HANDLE_HALF}px`, l: `calc(50% - ${HANDLE_HALF}px)`, cursor: 'n-resize' },
      { d: 'ne', t: `-${HANDLE_HALF}px`, r: `-${HANDLE_HALF}px`, cursor: 'ne-resize' },
      { d: 'e',  t: `calc(50% - ${HANDLE_HALF}px)`, r: `-${HANDLE_HALF}px`, cursor: 'e-resize' },
      { d: 'se', b: `-${HANDLE_HALF}px`, r: `-${HANDLE_HALF}px`, cursor: 'se-resize' },
      { d: 's',  b: `-${HANDLE_HALF}px`, l: `calc(50% - ${HANDLE_HALF}px)`, cursor: 's-resize' },
      { d: 'sw', b: `-${HANDLE_HALF}px`, l: `-${HANDLE_HALF}px`, cursor: 'sw-resize' },
      { d: 'w',  t: `calc(50% - ${HANDLE_HALF}px)`, l: `-${HANDLE_HALF}px`, cursor: 'w-resize' },
    ];
    defs.forEach(({ d, t, l, r, b, cursor }) => {
      const h = mkDiv(`position:absolute;width:${HANDLE_SIZE}px;height:${HANDLE_SIZE}px;
        background:#4A90D9;border:1px solid #fff;border-radius:2px;
        cursor:${cursor};pointer-events:all;box-sizing:border-box;`);
      if (t) { h.style.top = t; }
      if (l) { h.style.left = l; }
      if (r) { h.style.right = r; }
      if (b) { h.style.bottom = b; }
      h.addEventListener('mousedown', (e) => this.onResizeStart(e, d));
      this.box.appendChild(h);
    });
  }

  private onResizeStart(e: MouseEvent, dir: ResizeDir): void {
    if (!this.el || !this.iframe) { return; }
    e.preventDefault();
    e.stopPropagation();
    const p = this.elPos(this.el);
    if (!p) { return; }
    this.drag = { kind: 'resize', dir, startX: e.clientX, startY: e.clientY, startW: p.w, startH: p.h };
    this.iframe.style.pointerEvents = 'none';
  }

  // ---- reorder ----

  private onReorderStart(e: MouseEvent): void {
    if (!this.el || !this.iframe) { return; }
    e.preventDefault();
    e.stopPropagation();
    this.drag = { kind: 'reorder', startX: e.clientX, startY: e.clientY };
    this.iframe.style.pointerEvents = 'none';

    const ph = this.iframe.contentDocument!.createElement('div');
    const r = this.el.getBoundingClientRect();
    ph.style.cssText = `width:${r.width}px;height:${r.height}px;visibility:hidden;`;
    this.el.parentNode!.insertBefore(ph, this.el);
    this.placeholder = ph;
    this.el.style.opacity = '0.35';
  }

  private findDropTarget(clientX: number, clientY: number): { el: Element; position: 'before' | 'after' | 'inside' } | null {
    const doc = this.iframe!.contentDocument!;
    const iframeRect = this.iframe!.getBoundingClientRect();
    const ix = clientX - iframeRect.left;
    const iy = clientY - iframeRect.top;

    let candidate = doc.elementFromPoint(ix, iy);
    if (!candidate || candidate === this.el || candidate === this.placeholder) { return null; }

    const parent = this.el!.parentElement;
    if (!parent) { return null; }

    // Walk up candidate until its parent matches the dragged element's parent
    let node: Element | null = candidate;
    while (node && node.parentElement !== parent) {
      node = node.parentElement;
    }

    if (node && node !== this.el && node !== this.placeholder) {
      const r = node.getBoundingClientRect();
      const elTop = iframeRect.top + r.top;
      const zone = (clientY - elTop) / r.height;

      // Middle zone of a container → 'inside'
      if (CONTAINER_TAGS.has(node.tagName.toLowerCase()) && zone > 0.2 && zone < 0.8) {
        return { el: node, position: 'inside' };
      }
      return { el: node, position: clientY < elTop + r.height / 2 ? 'before' : 'after' };
    }

    // No sibling found — look for a container ancestor of candidate
    let container: Element | null = candidate;
    while (container && container !== doc.body && container !== doc.documentElement) {
      if (
        container !== this.el &&
        container !== this.placeholder &&
        CONTAINER_TAGS.has(container.tagName.toLowerCase())
      ) {
        const r = container.getBoundingClientRect();
        const elTop = iframeRect.top + r.top;
        const zone = (clientY - elTop) / r.height;
        if (zone > 0.05 && zone < 0.95) {
          return { el: container, position: 'inside' };
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  private updateDropMarker(drop: { el: Element; position: 'before' | 'after' | 'inside' } | null): void {
    if (!drop || !this.iframe) {
      this.dropMarker.style.display = 'none';
      this.dropInsideMarker.style.display = 'none';
      return;
    }
    const iframeRect = this.iframe.getBoundingClientRect();
    const previewRect = this.previewArea.getBoundingClientRect();
    const r = drop.el.getBoundingClientRect();

    if (drop.position === 'inside') {
      this.dropMarker.style.display = 'none';
      const x = iframeRect.left + r.left - previewRect.left;
      const y = iframeRect.top + r.top - previewRect.top;
      place(this.dropInsideMarker, x, y, r.width, r.height);
      this.dropInsideMarker.style.display = 'block';
      return;
    }

    this.dropInsideMarker.style.display = 'none';
    const markerY = drop.position === 'before'
      ? iframeRect.top + r.top - previewRect.top - 2
      : iframeRect.top + r.bottom - previewRect.top - 2;
    const markerX = iframeRect.left + r.left - previewRect.left;

    this.dropMarker.style.display = 'block';
    this.dropMarker.style.top = markerY + 'px';
    this.dropMarker.style.left = markerX + 'px';
    this.dropMarker.style.width = r.width + 'px';
  }

  // ---- mouse handlers ----

  private onMouseMove(e: MouseEvent): void {
    if (!this.drag || !this.el || !this.iframe) { return; }

    if (this.drag.kind === 'resize') {
      const dx = e.clientX - this.drag.startX;
      const dy = e.clientY - this.drag.startY;
      const d = this.drag.dir;
      if (d.includes('e')) { this.el.style.width = Math.max(10, this.drag.startW + dx) + 'px'; }
      if (d.includes('w')) { this.el.style.width = Math.max(10, this.drag.startW - dx) + 'px'; }
      if (d.includes('s')) { this.el.style.height = Math.max(10, this.drag.startH + dy) + 'px'; }
      if (d.includes('n')) { this.el.style.height = Math.max(10, this.drag.startH - dy) + 'px'; }
      this.update();
      return;
    }

    if (this.drag.kind === 'reorder') {
      const drop = this.findDropTarget(e.clientX, e.clientY);
      this.updateDropMarker(drop);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.drag || !this.el || !this.iframe) { return; }
    this.iframe.style.pointerEvents = '';

    if (this.drag.kind === 'resize') {
      if (this.el.style.width) { this.onStyleCommit('width', this.el.style.width); }
      if (this.el.style.height) { this.onStyleCommit('height', this.el.style.height); }
    }

    if (this.drag.kind === 'reorder') {
      const drop = this.findDropTarget(e.clientX, e.clientY);
      this.dropMarker.style.display = 'none';
      this.dropInsideMarker.style.display = 'none';

      if (this.placeholder) {
        this.placeholder.parentNode?.removeChild(this.placeholder);
        this.placeholder = null;
      }
      this.el.style.opacity = '';

      if (drop && this.currentPath) {
        const toPath = this.pathResolver(drop.el);
        // Update DOM for instant preview
        if (drop.position === 'inside') {
          drop.el.appendChild(this.el);
        } else if (drop.position === 'before') {
          drop.el.parentNode!.insertBefore(this.el, drop.el);
        } else {
          drop.el.parentNode!.insertBefore(this.el, drop.el.nextSibling);
        }
        this.onMoveCommit(this.currentPath, toPath, drop.position);
        this.currentPath = this.pathResolver(this.el);
      }
    }

    this.drag = null;
    this.update();
  }

  // ---- helpers ----

  private elPos(el: HTMLElement): { x: number; y: number; w: number; h: number } | null {
    if (!this.iframe) { return null; }
    const pr = this.previewArea.getBoundingClientRect();
    const ir = this.iframe.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return { x: ir.left + er.left - pr.left, y: ir.top + er.top - pr.top, w: er.width, h: er.height };
  }
}

function mkDiv(css: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = css.replace(/\s+/g, ' ').trim();
  return el;
}

function place(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}

function px(v: string): number { return parseFloat(v) || 0; }
