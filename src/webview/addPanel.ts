interface Snippet {
  label: string;
  tag: string;
  html: string;
}

const SNIPPETS: Snippet[] = [
  { label: 'Heading 1', tag: 'H1',  html: '<h1>Heading</h1>' },
  { label: 'Heading 2', tag: 'H2',  html: '<h2>Heading</h2>' },
  { label: 'Heading 3', tag: 'H3',  html: '<h3>Heading</h3>' },
  { label: 'Paragraph', tag: 'P',   html: '<p>Paragraph text</p>' },
  { label: 'Div',       tag: 'DIV', html: '<div>Container</div>' },
  { label: 'Flex Row',  tag: 'ROW', html: '<div style="display:flex;gap:16px;align-items:flex-start;">Container</div>' },
  { label: 'Image',     tag: 'IMG', html: '<img src="" alt="" />' },
  { label: 'List',      tag: 'UL',  html: '<ul>\n  <li>Item</li>\n  <li>Item</li>\n</ul>' },
  { label: 'Button',    tag: 'BTN', html: '<button>Button</button>' },
  { label: 'Link',      tag: 'A',   html: '<a href="#">Link</a>' },
];

export class AddPanel {
  constructor(
    private container: HTMLElement,
    private onInsert: (html: string) => void
  ) {
    this.render();
  }

  private render(): void {
    const parts: string[] = [];
    parts.push('<div class="section-header">ADD ELEMENT</div>');
    for (const s of SNIPPETS) {
      parts.push(
        `<div class="add-item" data-html="${escapeAttr(s.html)}">` +
        `<span class="add-tag">${s.tag}</span>${s.label}</div>`
      );
    }
    this.container.innerHTML = parts.join('');
    this.container.querySelectorAll<HTMLElement>('.add-item').forEach((item) => {
      item.addEventListener('click', () => this.onInsert(item.dataset.html!));
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
