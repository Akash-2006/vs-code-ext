import * as fs from 'fs/promises';
import * as path from 'path';
import { getSnippetRoots, isSnippetDefinition } from './snippetLoader';

const SNIPPET_EXTENSIONS = new Set(['.json', '.code-snippets']);

export interface SnippetFileOption {
  path: string;
  label: string;
}

export async function listExistingSnippetFiles(): Promise<SnippetFileOption[]> {
  const out: SnippetFileOption[] = [];
  for (const root of getSnippetRoots()) {
    let names: string[] = [];
    try {
      names = await fs.readdir(root.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!SNIPPET_EXTENSIONS.has(ext)) {
        continue;
      }
      const full = path.join(root.dir, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      out.push({ path: full, label: `${root.label} · ${name}` });
    }
  }
  out.sort((a, b) => compareSnippetFileOptions(a, b));
  return out;
}

/** Global snippet files first, then by label — makes “all languages” options easy to find. */
function compareSnippetFileOptions(a: SnippetFileOption, b: SnippetFileOption): number {
  const ga = a.path.toLowerCase().endsWith('.code-snippets') ? 0 : 1;
  const gb = b.path.toLowerCase().endsWith('.code-snippets') ? 0 : 1;
  if (ga !== gb) {
    return ga - gb;
  }
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

export interface AppendSnippetInput {
  title: string;
  prefix: string;
  description: string;
  body: string;
}

export async function readSnippetFileObject(absPath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(absPath, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw new Error('Could not parse snippet file as JSON.');
    }
  }
  return {};
}

function validateSnippetInput(input: AppendSnippetInput): {
  title: string;
  body: string;
  prefix: string;
  desc: string;
} {
  const title = input.title.trim();
  const body = input.body.replace(/\r\n/g, '\n');
  if (!title) {
    throw new Error('Title is required.');
  }
  if (!body.trim()) {
    throw new Error('Body is required.');
  }
  const prefix = input.prefix.trim();
  if (!prefix) {
    throw new Error('Prefix is required.');
  }
  return { title, body, prefix, desc: input.description.trim() };
}

function snippetEntryFromInput(input: AppendSnippetInput): Record<string, unknown> {
  const { title, body, prefix, desc } = validateSnippetInput(input);
  const lines = body.split('\n');
  const entry: Record<string, unknown> = {
    body: lines.length === 1 ? lines[0]! : lines,
    prefix,
  };
  if (desc) {
    entry.description = desc;
  }
  return entry;
}

export async function appendSnippetToFile(absPath: string, input: AppendSnippetInput): Promise<void> {
  const { title } = validateSnippetInput(input);
  const raw = await readSnippetFileObject(absPath);

  if (Object.prototype.hasOwnProperty.call(raw, title)) {
    throw new Error(`A snippet named "${title}" already exists in this file.`);
  }

  raw[title] = snippetEntryFromInput(input);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

export async function deleteSnippetFromFile(absPath: string, snippetTitle: string): Promise<void> {
  const raw = await readSnippetFileObject(absPath);
  if (!Object.prototype.hasOwnProperty.call(raw, snippetTitle)) {
    throw new Error(`Snippet "${snippetTitle}" not found in file.`);
  }
  delete raw[snippetTitle];
  await fs.writeFile(absPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

/** Update a snippet; preserves extra fields on the entry (e.g. `scope`). Title change renames the JSON key. */
export async function updateSnippetInFile(
  absPath: string,
  originalTitle: string,
  input: AppendSnippetInput,
): Promise<void> {
  const { title } = validateSnippetInput(input);
  const raw = await readSnippetFileObject(absPath);
  if (!Object.prototype.hasOwnProperty.call(raw, originalTitle)) {
    throw new Error(`Snippet "${originalTitle}" not found in file.`);
  }
  const oldVal = raw[originalTitle];
  if (!isSnippetDefinition(oldVal)) {
    throw new Error('Existing entry is not a valid snippet.');
  }
  const oldEntry = oldVal as Record<string, unknown>;
  const lines = input.body.replace(/\r\n/g, '\n').split('\n');
  const merged: Record<string, unknown> = { ...oldEntry };
  merged.body = lines.length === 1 ? lines[0]! : lines;
  merged.prefix = input.prefix.trim();
  const desc = input.description.trim();
  if (desc) {
    merged.description = desc;
  } else {
    delete merged.description;
  }

  delete raw[originalTitle];
  if (title !== originalTitle && Object.prototype.hasOwnProperty.call(raw, title)) {
    raw[originalTitle] = oldVal;
    throw new Error(`A snippet named "${title}" already exists in this file.`);
  }
  raw[title] = merged;

  await fs.writeFile(absPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

export function validateNewSnippetFileName(name: string): string | undefined {
  const t = name.trim();
  if (!t) {
    return 'File name is required.';
  }
  if (t.includes('/') || t.includes('\\') || t.includes('..')) {
    return 'Use a file name only, not a path.';
  }
  const ext = path.extname(t).toLowerCase();
  if (ext !== '.json' && ext !== '.code-snippets') {
    return 'Extension must be .json or .code-snippets.';
  }
  const base = path.basename(t);
  if (base !== t) {
    return 'Invalid file name.';
  }
  if (!/^[\w.\- ]+$/.test(t)) {
    return 'Use letters, numbers, spaces, dots, dashes, and underscores only.';
  }
  return undefined;
}
