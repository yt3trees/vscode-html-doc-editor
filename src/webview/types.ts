export type NodePath = number[];

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectElement'; path: NodePath }
  | { type: 'setStyle'; path: NodePath; prop: string; value: string }
  | { type: 'setText'; path: NodePath; text: string }
  | { type: 'removeElement'; path: NodePath }
  | { type: 'duplicateElement'; path: NodePath }
  | { type: 'moveElement'; fromPath: NodePath; toPath: NodePath; position: 'before' | 'after' | 'inside' }
  | { type: 'insertElement'; refPath: NodePath | null; position: 'after' | 'append'; html: string }
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' };

export type HostMessage =
  | { type: 'update'; html: string; version: number }
  | { type: 'error'; message: string };

export interface ElementInfo {
  path: NodePath;
  tagName: string;
  style: Record<string, string>;
  textContent: string;
  outerHTML: string;
}
