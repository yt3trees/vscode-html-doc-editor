import * as vscode from 'vscode';
import { HtmlEditorProvider } from './editor/htmlEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(HtmlEditorProvider.register(context));
}

export function deactivate(): void {}
