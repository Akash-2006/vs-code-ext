import * as vscode from 'vscode';
import { loadAllSnippets } from './snippetLoader';
import type { SnippetRecord } from './types';

export class SnippetModel {
  private readonly _onDidChangeSnippets = new vscode.EventEmitter<void>();
  readonly onDidChangeSnippets = this._onDidChangeSnippets.event;

  private snippets: SnippetRecord[] = [];
  private loadPromise: Promise<void>;

  constructor() {
    this.loadPromise = this.reloadSnippets();
  }

  getSnippetList(): SnippetRecord[] {
    return this.snippets;
  }

  private async reloadSnippets(): Promise<void> {
    this.snippets = await loadAllSnippets();
    this._onDidChangeSnippets.fire();
  }

  async refresh(): Promise<void> {
    this.loadPromise = this.reloadSnippets();
    await this.loadPromise;
  }

  async ensureLoaded(): Promise<void> {
    await this.loadPromise;
  }
}

export function groupSnippetsBySource(list: SnippetRecord[]): { source: string; snippets: SnippetRecord[] }[] {
  const byFile = new Map<string, SnippetRecord[]>();
  for (const s of list) {
    const arr = byFile.get(s.source) ?? [];
    arr.push(s);
    byFile.set(s.source, arr);
  }
  const files = [...byFile.keys()].sort((a, b) => a.localeCompare(b));
  return files.map((source) => {
    const snippets = byFile.get(source)!;
    snippets.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return { source, snippets };
  });
}

export function findSnippetByKey(list: SnippetRecord[], source: string, title: string): SnippetRecord | undefined {
  return list.find((s) => s.source === source && s.title === title);
}
