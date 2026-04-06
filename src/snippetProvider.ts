import * as vscode from 'vscode';
import type { SnippetQuickPickItem, SnippetRecord } from './types';

/** Relevance: lower sort key is better (title match beats prefix beats description). */
export function searchRelevanceKey(s: SnippetRecord, queryLower: string): { tier: number; index: number } {
  if (!queryLower) {
    return { tier: 0, index: 0 };
  }
  const title = s.title.toLowerCase();
  const desc = s.description.toLowerCase();
  const prefixes = s.prefix
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  let bestTier = 3;
  let bestIndex = Number.MAX_SAFE_INTEGER;

  const consider = (text: string, tier: number) => {
    const idx = text.indexOf(queryLower);
    if (idx === -1) {
      return;
    }
    if (tier < bestTier || (tier === bestTier && idx < bestIndex)) {
      bestTier = tier;
      bestIndex = idx;
    }
  };

  consider(title, 0);
  for (const p of prefixes) {
    consider(p, 1);
  }
  consider(desc, 2);

  if (bestTier === 3) {
    return { tier: 999, index: 999 };
  }
  return { tier: bestTier, index: bestIndex };
}

export function snippetMatchesQuery(s: SnippetRecord, queryLower: string): boolean {
  if (!queryLower) {
    return true;
  }
  const k = searchRelevanceKey(s, queryLower);
  return k.tier < 999;
}

export function formatSearchLabel(s: SnippetRecord): string {
  const prefixDisplay = s.prefix || '—';
  const desc = s.description || '';
  return `${s.title} (${prefixDisplay}) — ${desc}`;
}

export function primaryMatchField(s: SnippetRecord, queryLower: string): string | undefined {
  if (!queryLower) {
    return undefined;
  }
  const { tier } = searchRelevanceKey(s, queryLower);
  if (tier === 0) {
    return 'title';
  }
  if (tier === 1) {
    return 'prefix';
  }
  if (tier === 2) {
    return 'description';
  }
  return undefined;
}

export function buildSearchQuickPickItems(snippets: SnippetRecord[], query: string): SnippetQuickPickItem[] {
  const q = query.trim().toLowerCase();
  const filtered = snippets.filter((s) => snippetMatchesQuery(s, q));
  filtered.sort((a, b) => {
    const ka = searchRelevanceKey(a, q);
    const kb = searchRelevanceKey(b, q);
    if (ka.tier !== kb.tier) {
      return ka.tier - kb.tier;
    }
    if (ka.index !== kb.index) {
      return ka.index - kb.index;
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });

  return filtered.map((snippet) => {
    const field = primaryMatchField(snippet, q);
    const fieldTag = field ? ' · ' + field : '';
    return {
      label: formatSearchLabel(snippet),
      detail: snippet.source + fieldTag,
      snippet,
    } satisfies SnippetQuickPickItem;
  });
}

export async function insertSnippetIntoActiveEditor(snippet: SnippetRecord): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage('No active editor. Open a text editor to insert a snippet.');
    return false;
  }
  const snippetStr = new vscode.SnippetString(snippet.code);
  const ok = await editor.insertSnippet(snippetStr, editor.selections[0], {
    undoStopBefore: true,
    undoStopAfter: true,
  });
  return ok;
}

export async function copySnippetText(snippet: SnippetRecord): Promise<void> {
  await vscode.env.clipboard.writeText(snippet.code);
  void vscode.window.showInformationMessage(`Copied "${snippet.title}" to clipboard.`);
}
