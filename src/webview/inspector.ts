import type { NodePath } from './types';

type StyleSetter = (prop: string, value: string) => void;
type TextSetter = (text: string) => void;
type ElementAction = () => void;

interface InspectorState {
  path: NodePath;
  tagName: string;
  style: Record<string, string>;
  textContent: string;
  parentChain?: string[];
  mermaidSource?: string;
}

interface TableActions {
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onInsertColLeft: () => void;
  onInsertColRight: () => void;
  onRemoveRow: () => void;
  onRemoveColumn: () => void;
  onMergeRight: () => void;
  onMergeDown: () => void;
  onSplitCell: () => void;
}

const COLOR_PROPS = new Set([
  'color', 'background-color', 'background',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color',
]);

interface PropDef {
  label: string;
  prop: string;
  type: 'text' | 'number' | 'color';
  scrubbable?: boolean;
  units?: readonly string[];
}

const TYPOGRAPHY_PROPS: PropDef[] = [
  { label: 'Font',     prop: 'font-family',    type: 'text' },
  { label: 'Size',     prop: 'font-size',       type: 'text', scrubbable: true, units: ['px', 'rem', 'em'] },
  { label: 'Weight',   prop: 'font-weight',     type: 'text' },
  { label: 'Color',    prop: 'color',           type: 'color' },
  { label: 'Line',     prop: 'line-height',     type: 'text', scrubbable: true },
  { label: 'Tracking', prop: 'letter-spacing',  type: 'text', scrubbable: true, units: ['px', 'rem', 'em'] },
  { label: 'Align',    prop: 'text-align',      type: 'text' },
];

const SIZE_PROPS: PropDef[] = [
  { label: 'Width',  prop: 'width',      type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Height', prop: 'height',     type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Min-W',  prop: 'min-width',  type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Min-H',  prop: 'min-height', type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
];

const BOX_PROPS: PropDef[] = [
  { label: 'Opacity',  prop: 'opacity',          type: 'text', scrubbable: true },
  { label: 'Padding',  prop: 'padding',           type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Margin',   prop: 'margin',            type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Border',   prop: 'border',            type: 'text' },
  { label: 'Bg Color', prop: 'background-color',  type: 'color' },
  { label: 'Radius',   prop: 'border-radius',     type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
];

const POSITION_PROPS: PropDef[] = [
  { label: 'Position', prop: 'position', type: 'text' },
  { label: 'Top',      prop: 'top',      type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Right',    prop: 'right',    type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Bottom',   prop: 'bottom',   type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
  { label: 'Left',     prop: 'left',     type: 'text', scrubbable: true, units: ['px', 'rem', '%'] },
];

const ALL_PROPS = [...TYPOGRAPHY_PROPS, ...SIZE_PROPS, ...BOX_PROPS, ...POSITION_PROPS];

export class Inspector {
  private state: InspectorState | null = null;

  constructor(
    private container: HTMLElement,
    private onSetStyle: StyleSetter,
    private onStyleLive: StyleSetter,
    private onSetText: TextSetter,
    private onRemove: ElementAction,
    private onDuplicate: ElementAction,
    private tableActions: TableActions
  ) {}

  show(state: InspectorState): void {
    this.state = state;
    this.render();
  }

  clear(): void {
    this.state = null;
    this.container.innerHTML = '<p style="padding:12px;opacity:0.5;">Select an element</p>';
  }

  private isTableContext(): boolean {
    if (!this.state) { return false; }
    const { tagName, parentChain } = this.state;
    const tableTags = new Set(['table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot']);
    if (tableTags.has(tagName)) { return true; }
    if (parentChain) { return parentChain.some((t) => tableTags.has(t)); }
    return false;
  }

  private render(): void {
    if (!this.state) { return; }
    if (this.state.mermaidSource !== undefined) {
      this.renderMermaidMode();
      return;
    }
    const { tagName, style, textContent } = this.state;
    const html: string[] = [];

    html.push(`<div class="section-header">&lt;${tagName}&gt;</div>`);
    html.push('<div class="action-row">');
    html.push('<button id="btn-duplicate">Duplicate</button>');
    html.push('<button id="btn-remove" class="danger">Delete</button>');
    html.push('</div>');

    if (this.isTableContext()) {
      const isTable = tagName === 'table';
      const isTr = tagName === 'tr';
      const isCell = tagName === 'td' || tagName === 'th';
      const disableAll = isTable ? 'disabled' : '';
      const disableColMerge = (isTable || isTr) ? 'disabled' : '';
      html.push('<div class="section-label">TABLE</div>');
      html.push('<div class="table-actions">');
      html.push(`<button class="tbl-btn" id="tbl-row-above" ${disableAll}>Row ▲</button>`);
      html.push(`<button class="tbl-btn" id="tbl-row-below" ${disableAll}>Row ▼</button>`);
      html.push(`<button class="tbl-btn" id="tbl-col-left" ${disableColMerge}>Col ◄</button>`);
      html.push(`<button class="tbl-btn" id="tbl-col-right" ${disableColMerge}>Col ►</button>`);
      html.push(`<button class="tbl-btn danger" id="tbl-del-row" ${disableAll}>Del Row</button>`);
      html.push(`<button class="tbl-btn danger" id="tbl-del-col" ${disableColMerge}>Del Col</button>`);
      html.push(`<button class="tbl-btn" id="tbl-merge-right" ${disableColMerge}>Merge →</button>`);
      html.push(`<button class="tbl-btn" id="tbl-merge-down" ${disableColMerge}>Merge ↓</button>`);
      html.push(`<button class="tbl-btn tbl-btn-wide" id="tbl-split" ${disableColMerge}>Split Cell</button>`);
      if (isTable) {
        html.push('<p class="tbl-hint">Select a cell to edit rows &amp; columns</p>');
      } else if (isTr) {
        html.push('<p class="tbl-hint">Select a cell to edit columns &amp; merge</p>');
      }
      html.push('</div>');
    }

    if (textContent.trim()) {
      html.push('<div class="section-label">TEXT</div>');
      html.push('<div class="field-row full">');
      html.push(`<textarea class="field-input" id="text-edit" rows="3">${escapeAttr(textContent.trim())}</textarea>`);
      html.push('</div>');
    }

    html.push('<div class="section-label">TYPOGRAPHY</div>');
    for (const def of TYPOGRAPHY_PROPS) {
      html.push(this.renderField(def, style[def.prop] ?? ''));
    }

    html.push('<div class="section-label">SIZE</div>');
    for (const def of SIZE_PROPS) {
      html.push(this.renderField(def, style[def.prop] ?? ''));
    }

    html.push('<div class="section-label">BOX</div>');
    for (const def of BOX_PROPS) {
      html.push(this.renderField(def, style[def.prop] ?? ''));
    }

    html.push('<div class="section-label">POSITION</div>');
    for (const def of POSITION_PROPS) {
      html.push(this.renderField(def, style[def.prop] ?? ''));
    }

    this.container.innerHTML = html.join('');
    this.attachListeners();
  }

  private renderMermaidMode(): void {
    const dsl = this.state!.mermaidSource!;
    this.container.innerHTML = `
      <div class="section-header">&lt;div.mermaid&gt;</div>
      <div class="action-row">
        <button id="btn-duplicate">Duplicate</button>
        <button id="btn-remove" class="danger">Delete</button>
      </div>
      <div class="section-label">MERMAID DSL</div>
      <div class="field-row full">
        <textarea id="mermaid-edit" rows="14" style="font-family:var(--vscode-editor-font-family,monospace);font-size:11px;resize:vertical;width:100%;background:var(--vscode-input-background,#3c3c3c);color:var(--vscode-input-foreground,#ccc);border:1px solid var(--vscode-input-border,#555);padding:4px;border-radius:2px;">${escapeAttr(dsl)}</textarea>
      </div>
      <div class="action-row" style="margin-top:4px;">
        <button id="btn-mermaid-save" style="background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;">Save DSL</button>
      </div>
      <p style="padding:6px 8px;font-size:10px;opacity:0.5;">Ctrl+Enter to save &amp; re-render</p>
    `;

    const textarea = this.container.querySelector<HTMLTextAreaElement>('#mermaid-edit')!;
    const commitDsl = () => this.onSetText(textarea.value);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commitDsl();
      }
    });
    document.getElementById('btn-mermaid-save')?.addEventListener('click', commitDsl);
    document.getElementById('btn-remove')?.addEventListener('click', () => this.onRemove());
    document.getElementById('btn-duplicate')?.addEventListener('click', () => this.onDuplicate());
  }

  private renderField(def: PropDef, value: string): string {
    if (def.type === 'color') {
      const hex = toHex(value);
      const pickerVal = hex || '#000000';
      return `<div class="color-row" data-prop="${def.prop}">
        <label class="field-label">${def.label}</label>
        <input class="color-picker" type="color" data-prop="${def.prop}" value="${pickerVal}" title="${def.prop}" />
        <input class="color-hex field-input" type="text" data-prop="${def.prop}" value="${escapeAttr(value)}" placeholder="#rrggbb or name" />
      </div>`;
    }

    const labelStyle = def.scrubbable
      ? ' style="cursor:ew-resize;user-select:none;"'
      : '';
    const scrubAttr = def.scrubbable ? ` data-scrub="${def.prop}"` : '';

    const unitBadge = (() => {
      if (!def.units || !def.units.length) { return ''; }
      const parsed = parseNumUnit(value);
      if (!parsed) { return ''; }
      const unit = parsed.unit || def.units[0];
      return `<span class="unit-badge" data-prop="${def.prop}">${escapeAttr(unit)}</span>`;
    })();

    return `<div class="field-row">
      <label class="field-label"${labelStyle}${scrubAttr}>${def.label}</label>
      <input class="field-input" type="text" data-prop="${def.prop}" value="${escapeAttr(value)}" />
      ${unitBadge}
    </div>`;
  }

  private attachListeners(): void {
    // Plain text inputs
    this.container.querySelectorAll<HTMLInputElement>('input.field-input:not(.color-hex)').forEach((input) => {
      const commit = () => this.onSetStyle(input.dataset.prop!, input.value);
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); } });
    });

    // Color picker
    this.container.querySelectorAll<HTMLInputElement>('input.color-picker').forEach((picker) => {
      const prop = picker.dataset.prop!;
      const hexInput = this.container.querySelector<HTMLInputElement>(`.color-hex[data-prop="${prop}"]`);

      picker.addEventListener('input', () => {
        if (hexInput) { hexInput.value = picker.value; }
      });
      picker.addEventListener('change', () => {
        if (hexInput) { hexInput.value = picker.value; }
        this.onSetStyle(prop, picker.value);
      });
    });

    // Hex text input
    this.container.querySelectorAll<HTMLInputElement>('input.color-hex').forEach((hexInput) => {
      const prop = hexInput.dataset.prop!;
      const picker = this.container.querySelector<HTMLInputElement>(`.color-picker[data-prop="${prop}"]`);

      const sync = () => {
        const hex = toHex(hexInput.value);
        if (hex && picker) { picker.value = hex; }
      };
      const commit = () => {
        sync();
        this.onSetStyle(prop, hexInput.value.trim());
      };
      hexInput.addEventListener('input', sync);
      hexInput.addEventListener('change', commit);
      hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); } });
    });

    // Textarea (text content)
    const textarea = this.container.querySelector<HTMLTextAreaElement>('#text-edit');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.onSetText(textarea.value);
        }
      });
      textarea.addEventListener('blur', () => this.onSetText(textarea.value));
    }

    document.getElementById('btn-remove')?.addEventListener('click', () => this.onRemove());
    document.getElementById('btn-duplicate')?.addEventListener('click', () => this.onDuplicate());

    // Table buttons
    document.getElementById('tbl-row-above')?.addEventListener('click', () => this.tableActions.onInsertRowAbove());
    document.getElementById('tbl-row-below')?.addEventListener('click', () => this.tableActions.onInsertRowBelow());
    document.getElementById('tbl-col-left')?.addEventListener('click', () => this.tableActions.onInsertColLeft());
    document.getElementById('tbl-col-right')?.addEventListener('click', () => this.tableActions.onInsertColRight());
    document.getElementById('tbl-del-row')?.addEventListener('click', () => this.tableActions.onRemoveRow());
    document.getElementById('tbl-del-col')?.addEventListener('click', () => this.tableActions.onRemoveColumn());
    document.getElementById('tbl-merge-right')?.addEventListener('click', () => this.tableActions.onMergeRight());
    document.getElementById('tbl-merge-down')?.addEventListener('click', () => this.tableActions.onMergeDown());
    document.getElementById('tbl-split')?.addEventListener('click', () => this.tableActions.onSplitCell());

    // Scrub: drag label to change numeric values
    this.container.querySelectorAll<HTMLElement>('[data-scrub]').forEach((label) => {
      const prop = label.dataset.scrub!;
      const input = this.container.querySelector<HTMLInputElement>(`input.field-input[data-prop="${prop}"]`);
      if (!input) { return; }

      let scrubbing = false;
      let startX = 0;
      let startVal = 0;
      let startUnit = '';

      label.addEventListener('pointerdown', (e) => {
        const parsed = parseNumUnit(input.value);
        if (!parsed) { return; }
        startX = e.clientX;
        startVal = parsed.num;
        startUnit = parsed.unit;
        scrubbing = true;
        label.setPointerCapture(e.pointerId);
        e.preventDefault();
      });

      label.addEventListener('pointermove', (e) => {
        if (!scrubbing) { return; }
        const dx = e.clientX - startX;
        const sens = getSensitivity(startUnit, prop);
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const newNum = startVal + dx * sens * mult;
        const formatted = formatValue(newNum, startUnit, prop);
        input.value = formatted;
        this.onStyleLive(prop, formatted);
      });

      label.addEventListener('pointerup', () => {
        if (!scrubbing) { return; }
        scrubbing = false;
        this.onSetStyle(prop, input.value);
      });

      label.addEventListener('pointercancel', () => { scrubbing = false; });
    });

    // Unit badge: click to cycle unit
    this.container.querySelectorAll<HTMLElement>('.unit-badge').forEach((badge) => {
      const prop = badge.dataset.prop!;
      const input = this.container.querySelector<HTMLInputElement>(`input.field-input[data-prop="${prop}"]`);
      const def = ALL_PROPS.find((d) => d.prop === prop);
      if (!input || !def || !def.units) { return; }

      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const parsed = parseNumUnit(input.value);
        if (!parsed) { return; }
        const units = def.units!;
        const currentUnit = parsed.unit || units[0];
        const idx = units.indexOf(currentUnit);
        const nextUnit = units[(idx + 1) % units.length];
        const newVal = `${parsed.num}${nextUnit}`;
        input.value = newVal;
        badge.textContent = nextUnit;
        this.onSetStyle(prop, newVal);
      });
    });
  }
}

// ---- numeric helpers ----

function parseNumUnit(value: string): { num: number; unit: string } | null {
  const m = value.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/);
  if (!m) { return null; }
  return { num: parseFloat(m[1]), unit: m[2] };
}

function getSensitivity(unit: string, prop: string): number {
  if (prop === 'opacity') { return 0.005; }
  if (unit === 'rem' || unit === 'em') { return 0.05; }
  if (unit === '%') { return 0.5; }
  return 1;
}

function formatValue(num: number, unit: string, prop: string): string {
  if (prop === 'opacity') {
    const clamped = Math.min(1, Math.max(0, num));
    return trimNum(clamped.toFixed(2));
  }
  if (unit === 'rem' || unit === 'em') {
    return trimNum((Math.round(num * 100) / 100).toFixed(2)) + unit;
  }
  if (unit === '%') {
    return trimNum((Math.round(num * 10) / 10).toFixed(1)) + unit;
  }
  return Math.round(num) + unit;
}

function trimNum(s: string): string {
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// ---- color helpers ----

function toHex(value: string): string {
  if (!value) { return ''; }
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  if (/^#[0-9a-f]{6}$/.test(v)) {
    return v;
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return '#' + hex2(parseInt(rgb[1])) + hex2(parseInt(rgb[2])) + hex2(parseInt(rgb[3]));
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) { return ''; }
  ctx.fillStyle = v;
  const computed = ctx.fillStyle;
  if (computed.startsWith('#')) { return computed; }
  const m = computed.match(/\d+/g);
  if (m && m.length >= 3) {
    return '#' + hex2(parseInt(m[0])) + hex2(parseInt(m[1])) + hex2(parseInt(m[2]));
  }
  return '';
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
