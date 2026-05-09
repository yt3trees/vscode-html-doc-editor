import * as vscode from 'vscode';
import { parseHtml, applySetStyle, applySetText, applySetInnerHtml, applyRemoveElement, applyDuplicateElement, applyMoveElement, applyInsertElement, applyInsertRow, applyInsertColumn, applyRemoveRow, applyRemoveColumn, applyMergeCellRight, applyMergeCellDown, applySplitCell } from './astPatcher';
import type { WebviewMessage, HostMessage } from './messageProtocol';

export class HtmlEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'editHtml.visualEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new HtmlEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(HtmlEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    webviewPanel.webview.html = this.buildWebviewHtml(webviewPanel.webview);

    const sendUpdate = () => {
      const html = document.getText();
      const msg: HostMessage = { type: 'update', html, version: document.version };
      webviewPanel.webview.postMessage(msg);
    };

    const onDocChange = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendUpdate();
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.type === 'ready') {
        sendUpdate();
        return;
      }
      try {
        await this.handleMessage(document, msg);
      } catch (err) {
        const errMsg: HostMessage = { type: 'error', message: String(err) };
        webviewPanel.webview.postMessage(errMsg);
      }
    });

    webviewPanel.onDidDispose(() => onDocChange.dispose());
  }

  private async handleMessage(document: vscode.TextDocument, msg: WebviewMessage): Promise<void> {
    console.log('[edit-html] msg:', msg.type);
    if (msg.type === 'ready') {
      return;
    }

    const source = document.getText();
    const doc = parseHtml(source);
    let newSource = source;

    if (msg.type === 'setStyle') {
      newSource = applySetStyle(source, doc, msg.path, msg.prop, msg.value);
    } else if (msg.type === 'setText') {
      newSource = applySetText(source, doc, msg.path, msg.text);
    } else if (msg.type === 'setInnerHtml') {
      newSource = applySetInnerHtml(source, doc, msg.path, msg.html);
    } else if (msg.type === 'removeElement') {
      newSource = applyRemoveElement(source, doc, msg.path);
    } else if (msg.type === 'duplicateElement') {
      newSource = applyDuplicateElement(source, doc, msg.path);
    } else if (msg.type === 'moveElement') {
      newSource = applyMoveElement(source, doc, msg.fromPath, msg.toPath, msg.position);
    } else if (msg.type === 'insertElement') {
      newSource = applyInsertElement(source, doc, msg.refPath, msg.position, msg.html);
    } else if (msg.type === 'insertRow') {
      newSource = applyInsertRow(source, doc, msg.path, msg.position);
      console.log(`[edit-html] insertRow changed=${newSource !== source}`);
    } else if (msg.type === 'insertColumn') {
      newSource = applyInsertColumn(source, doc, msg.path, msg.position);
      console.log(`[edit-html] insertColumn path=${JSON.stringify(msg.path)} changed=${newSource !== source}`);
    } else if (msg.type === 'removeRow') {
      newSource = applyRemoveRow(source, doc, msg.path);
      console.log(`[edit-html] removeRow changed=${newSource !== source}`);
    } else if (msg.type === 'removeColumn') {
      newSource = applyRemoveColumn(source, doc, msg.path);
      console.log(`[edit-html] removeColumn path=${JSON.stringify(msg.path)} changed=${newSource !== source}`);
    } else if (msg.type === 'mergeCellRight') {
      newSource = applyMergeCellRight(source, doc, msg.path);
      console.log(`[edit-html] mergeCellRight changed=${newSource !== source}`);
    } else if (msg.type === 'mergeCellDown') {
      newSource = applyMergeCellDown(source, doc, msg.path);
      console.log(`[edit-html] mergeCellDown changed=${newSource !== source}`);
    } else if (msg.type === 'splitCell') {
      newSource = applySplitCell(source, doc, msg.path);
      console.log(`[edit-html] splitCell changed=${newSource !== source}`);
    } else if (msg.type === 'save') {
      await document.save();
      return;
    } else if (msg.type === 'undo') {
      await vscode.commands.executeCommand('undo');
      return;
    } else if (msg.type === 'redo') {
      await vscode.commands.executeCommand('redo');
      return;
    } else {
      return;
    }

    if (newSource === source) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(source.length)
    );
    edit.replace(document.uri, fullRange, newSource);
    await vscode.workspace.applyEdit(edit);
  }

  private buildWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline'; style-src 'unsafe-inline'; frame-src *; img-src * data: blob:; font-src *;">
  <title>HTML Document Editor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      display: flex;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    #left-panel {
      width: 200px;
      min-width: 150px;
      border-right: 1px solid var(--vscode-editorGroup-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
    }
    #outline {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      min-height: 60px;
    }
    #add-panel {
      height: 210px;
      flex-shrink: 0;
      border-top: 1px solid var(--vscode-editorGroup-border);
      overflow-y: auto;
    }
    #preview-area {
      flex: 1;
      overflow: hidden;
      position: relative;
      background: #fff;
    }
    #preview-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
    #inspector {
      width: 260px;
      min-width: 220px;
      border-left: 1px solid var(--vscode-editorGroup-border);
      overflow-y: auto;
      padding: 8px;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div id="left-panel">
    <div id="outline"></div>
    <div id="add-panel"></div>
  </div>
  <div id="preview-area">
    <iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
  </div>
  <div id="inspector"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
