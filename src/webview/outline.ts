type ClickCallback = (path: number[]) => void;

export interface HeadingEntry {
  text: string;
  level: number;
  path: number[];
}

export class Outline {
  constructor(
    private container: HTMLElement,
    private onClick: ClickCallback
  ) {}

  updateFromData(entries: HeadingEntry[]): void {
    if (entries.length === 0) {
      this.container.innerHTML = '<p style="padding:12px;opacity:0.5;">見出しなし</p>';
      return;
    }

    const items = entries.map(({ text, level, path }) => {
      const indent = (level - 1) * 12;
      return `<div class="outline-item" data-path="${escapeAttr(JSON.stringify(path))}" style="padding-left:${8 + indent}px">
        <span class="outline-level">h${level}</span>
        <span class="outline-text">${escapeHtml(text)}</span>
      </div>`;
    });

    this.container.innerHTML = items.join('');

    this.container.querySelectorAll<HTMLElement>('.outline-item').forEach((item) => {
      item.addEventListener('click', () => {
        const path = JSON.parse(item.dataset.path ?? '[]') as number[];
        this.onClick(path);
      });
    });
  }

  highlight(path: number[]): void {
    const pathStr = JSON.stringify(path);
    this.container.querySelectorAll<HTMLElement>('.outline-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.path === pathStr);
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
