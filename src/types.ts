import * as vscode from 'vscode';

/** Normalized snippet from a user snippets file. */
export interface SnippetRecord {
  title: string;
  description: string;
  prefix: string;
  code: string;
  source: string;
}

/** Shape inside VS Code JSON snippet files. */
export interface RawSnippetDefinition {
  prefix?: string | string[];
  body?: string | string[];
  description?: string;
  scope?: string;
}

export type SnippetFileJson = Record<string, unknown>;

/** Quick Pick entry carrying the resolved snippet for insert. */
export interface SnippetQuickPickItem extends vscode.QuickPickItem {
  readonly snippet: SnippetRecord;
}
