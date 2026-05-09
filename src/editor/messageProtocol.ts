export type NodePath = number[];

// Webview -> Host
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectElement'; path: NodePath }
  | { type: 'setStyle'; path: NodePath; prop: string; value: string }
  | { type: 'setText'; path: NodePath; text: string }
  | { type: 'removeElement'; path: NodePath }
  | { type: 'duplicateElement'; path: NodePath }
  | { type: 'moveElement'; fromPath: NodePath; toPath: NodePath; position: 'before' | 'after' | 'inside' }
  | { type: 'insertElement'; refPath: NodePath | null; position: 'after' | 'append'; html: string }
  | { type: 'setInnerHtml'; path: NodePath; html: string }
  | { type: 'insertRow'; path: NodePath; position: 'before' | 'after' }
  | { type: 'insertColumn'; path: NodePath; position: 'before' | 'after' }
  | { type: 'removeRow'; path: NodePath }
  | { type: 'removeColumn'; path: NodePath }
  | { type: 'mergeCellRight'; path: NodePath }
  | { type: 'mergeCellDown'; path: NodePath }
  | { type: 'splitCell'; path: NodePath }
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' };

// Host -> Webview
export type HostMessage =
  | { type: 'update'; html: string; version: number }
  | { type: 'error'; message: string };
