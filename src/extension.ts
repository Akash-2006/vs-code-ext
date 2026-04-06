import * as vscode from 'vscode';
import { SnippetModel } from './snippetModel';
import { copySnippetText, insertSnippetIntoActiveEditor } from './snippetProvider';
import type { SnippetRecord } from './types';
import { SnippetsWebviewViewProvider } from './snippetsWebview';

export function activate(context: vscode.ExtensionContext): void {
  const model = new SnippetModel();
  const webviewProvider = new SnippetsWebviewViewProvider(context.extensionUri, model);

  const resolveSnippetArgument = (arg: unknown): SnippetRecord | undefined => {
    if (arg && typeof arg === 'object' && 'source' in arg && 'title' in arg) {
      const o = arg as { source: unknown; title: unknown };
      if (typeof o.source === 'string' && typeof o.title === 'string') {
        return model.getSnippetList().find((s) => s.source === o.source && s.title === o.title);
      }
    }
    return undefined;
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SnippetsWebviewViewProvider.viewId, webviewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand('snippets-manager.refreshSnippets', async () => {
      await webviewProvider.refreshView();
      void vscode.window.showInformationMessage('Snippets refreshed.');
    }),

    vscode.commands.registerCommand(
      'snippets-manager.insertSnippet',
      async (arg?: { source: string; title: string }) => {
        const snippet = resolveSnippetArgument(arg);
        if (!snippet) {
          void vscode.window.showWarningMessage(
            'Use the Snippets side bar: expand a file, then click Insert on a snippet.',
          );
          return;
        }
        await insertSnippetIntoActiveEditor(snippet);
      },
    ),

    vscode.commands.registerCommand(
      'snippets-manager.copySnippet',
      async (arg?: { source: string; title: string }) => {
        const snippet = resolveSnippetArgument(arg);
        if (!snippet) {
          void vscode.window.showWarningMessage(
            'Use the Snippets side bar: expand a file, then click Copy on a snippet.',
          );
          return;
        }
        await copySnippetText(snippet);
      },
    ),

    vscode.commands.registerCommand('snippets-manager.searchSnippets', () => {
      webviewProvider.focusFilter();
    }),
  );
}

export function deactivate(): void {
  /* extension cleanup handled via context.subscriptions */
}
