import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { RawSnippetDefinition, SnippetFileJson, SnippetRecord } from './types';

const SNIPPET_EXTENSIONS = new Set(['.json', '.code-snippets']);

export function isSnippetDefinition(v: unknown): v is RawSnippetDefinition {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const o = v as RawSnippetDefinition;
  return o.body !== undefined && (typeof o.body === 'string' || Array.isArray(o.body));
}

export interface SnippetRoot {
  /** Shown in the UI so you can tell Code vs Cursor snippets apart. */
  label: string;
  dir: string;
}

/** Known user snippet folders (VS Code + Cursor) — only existing dirs are read. */
export function getSnippetRoots(): SnippetRoot[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA;
      if (!appData) {
        return [];
      }
      const base = appData;
      return [
        { label: 'VS Code', dir: path.join(base, 'Code', 'User', 'snippets') },
        { label: 'Cursor', dir: path.join(base, 'Cursor', 'User', 'snippets') },
      ];
    }
    case 'darwin': {
      const sup = path.join(home, 'Library', 'Application Support');
      return [
        { label: 'VS Code', dir: path.join(sup, 'Code', 'User', 'snippets') },
        { label: 'Cursor', dir: path.join(sup, 'Cursor', 'User', 'snippets') },
      ];
    }
    default: {
      const cfg = path.join(home, '.config');
      return [
        { label: 'VS Code', dir: path.join(cfg, 'Code', 'User', 'snippets') },
        { label: 'Cursor', dir: path.join(cfg, 'Cursor', 'User', 'snippets') },
      ];
    }
  }
}

function normalizePrefix(prefix: string | string[] | undefined): string {
  if (prefix === undefined) {
    return '';
  }
  if (Array.isArray(prefix)) {
    return prefix.filter((p) => typeof p === 'string').join(', ');
  }
  return String(prefix);
}

function normalizeBody(body: string | string[]): string {
  if (Array.isArray(body)) {
    return body.join('\n');
  }
  return body;
}

function parseSnippetFile(
  contents: string,
  sourceFileName: string,
  rootLabel: string,
  absoluteFilePath: string,
): SnippetRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(contents) as unknown;
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  const obj = data as SnippetFileJson;
  const out: SnippetRecord[] = [];
  const source = `${rootLabel} · ${sourceFileName}`;

  for (const [title, raw] of Object.entries(obj)) {
    if (!isSnippetDefinition(raw)) {
      continue;
    }
    const prefix = normalizePrefix(raw.prefix);
    const code = normalizeBody(raw.body!);
    out.push({
      title,
      description: raw.description ?? '',
      prefix,
      code,
      source,
      filePath: absoluteFilePath,
    });
  }
  return out;
}

async function loadFromDir(root: SnippetRoot): Promise<SnippetRecord[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root.dir);
  } catch {
    return [];
  }

  const results: SnippetRecord[] = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!SNIPPET_EXTENSIONS.has(ext)) {
      continue;
    }
    const full = path.join(root.dir, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    let text: string;
    try {
      text = await fs.readFile(full, 'utf8');
    } catch {
      continue;
    }
    results.push(...parseSnippetFile(text, name, root.label, full));
  }
  return results;
}

export async function loadAllSnippets(): Promise<SnippetRecord[]> {
  const merged: SnippetRecord[] = [];
  for (const root of getSnippetRoots()) {
    merged.push(...(await loadFromDir(root)));
  }
  return merged;
}
