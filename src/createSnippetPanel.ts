import * as path from 'path';
import * as vscode from 'vscode';
import {
  appendSnippetToFile,
  listExistingSnippetFiles,
  updateSnippetInFile,
  validateNewSnippetFileName,
  type AppendSnippetInput,
} from './snippetWriter';
import { getSnippetRoots } from './snippetLoader';
import type { SnippetModel } from './snippetModel';
import type { SnippetRecord } from './types';
import type { SnippetsWebviewViewProvider } from './snippetsWebview';

type InitMessage = {
  type: 'init';
  existingFiles: { path: string; label: string }[];
  /** Split for optgroups in the form (global = .code-snippets). */
  globalFiles: { path: string; label: string }[];
  langFiles: { path: string; label: string }[];
  roots: { dir: string; label: string }[];
};

type SubmitExisting = {
  type: 'submit';
  mode: 'existing';
  title: string;
  prefix: string;
  description: string;
  body: string;
  filePath: string;
};

type SubmitNew = {
  type: 'submit';
  mode: 'new';
  title: string;
  prefix: string;
  description: string;
  body: string;
  rootDir: string;
  fileName: string;
};

type SubmitEdit = {
  type: 'submitEdit';
  title: string;
  prefix: string;
  description: string;
  body: string;
};

type FromWebview = { type: 'ready' } | SubmitExisting | SubmitNew | SubmitEdit;

let currentPanel: vscode.WebviewPanel | undefined;
let currentPanelKind: 'create' | 'edit' | null = null;

export function openCreateSnippetPanel(
  extensionUri: vscode.Uri,
  model: SnippetModel,
  library: SnippetsWebviewViewProvider,
): void {
  if (currentPanel && currentPanelKind === 'create') {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  if (currentPanel) {
    currentPanel.dispose();
  }
  mountSnippetFormPanel(extensionUri, model, library, undefined);
}

export function openEditSnippetPanel(
  extensionUri: vscode.Uri,
  model: SnippetModel,
  library: SnippetsWebviewViewProvider,
  editTarget: SnippetRecord,
): void {
  if (currentPanel) {
    currentPanel.dispose();
  }
  mountSnippetFormPanel(extensionUri, model, library, editTarget);
}

function mountSnippetFormPanel(
  extensionUri: vscode.Uri,
  model: SnippetModel,
  library: SnippetsWebviewViewProvider,
  editTarget?: SnippetRecord,
): void {
  currentPanelKind = editTarget ? 'edit' : 'create';
  const editOriginalTitle = editTarget?.title;
  const editFilePath = editTarget?.filePath;

  currentPanel = vscode.window.createWebviewPanel(
    'snippetsManagerCreateSnippet',
    editTarget ? 'Edit Snippet' : 'Create Snippet',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    },
  );

  const nonce =
    Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64').slice(0, 32) +
    Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64').slice(0, 32);

  const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join(
    '; ',
  );

  currentPanel.webview.html = getHtml(nonce, csp, editTarget);

  const messageSub = currentPanel.webview.onDidReceiveMessage(
    async (msg: FromWebview) => {
      if (!currentPanel) {
        return;
      }
      if (msg?.type === 'ready') {
        const existingFiles = await listExistingSnippetFiles();
        const globalFiles = existingFiles.filter((f) => f.path.toLowerCase().endsWith('.code-snippets'));
        const langFiles = existingFiles.filter((f) => f.path.toLowerCase().endsWith('.json'));
        const roots = getSnippetRoots();
        const init: InitMessage = {
          type: 'init',
          existingFiles,
          globalFiles,
          langFiles,
          roots: roots.map((r) => ({ dir: r.dir, label: r.label })),
        };
        void currentPanel.webview.postMessage(init);
        return;
      }
      if (msg?.type === 'submitEdit') {
        if (!editFilePath || !editOriginalTitle) {
          return;
        }
        const input: AppendSnippetInput = {
          title: msg.title,
          prefix: msg.prefix,
          description: msg.description,
          body: msg.body,
        };
        try {
          await updateSnippetInFile(editFilePath, editOriginalTitle, input);
          await model.refresh();
          await library.refreshView();
          void vscode.window.showInformationMessage('Snippet updated.');
          currentPanel.dispose();
        } catch (e: unknown) {
          const m =
            e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not update snippet.';
          void currentPanel.webview.postMessage({ type: 'error', message: m });
        }
        return;
      }
      if (msg?.type === 'submit') {
        const input: AppendSnippetInput = {
          title: msg.title,
          prefix: msg.prefix,
          description: msg.description,
          body: msg.body,
        };
        try {
          let targetPath: string;
          if (msg.mode === 'existing') {
            targetPath = msg.filePath;
          } else {
            const nameErr = validateNewSnippetFileName(msg.fileName);
            if (nameErr) {
              void currentPanel.webview.postMessage({ type: 'error', message: nameErr });
              return;
            }
            if (!msg.fileName.trim().toLowerCase().endsWith('.code-snippets')) {
              void currentPanel.webview.postMessage({
                type: 'error',
                message: 'New files must use a .code-snippets extension so snippets work in all languages.',
              });
              return;
            }
            targetPath = path.join(msg.rootDir, path.basename(msg.fileName.trim()));
          }
          await appendSnippetToFile(targetPath, input);
          await model.refresh();
          await library.refreshView();
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
          await vscode.window.showTextDocument(doc, { preview: true });
          const base = path.basename(targetPath);
          const ext = path.extname(targetPath).toLowerCase();
          let savedMsg = `Snippet saved to ${base}.`;
          if (ext === '.code-snippets') {
            savedMsg += ' This file applies in all language modes (unless a snippet sets scope).';
          } else if (ext === '.json') {
            const langId = path.basename(targetPath, ext);
            savedMsg += ` That file only applies when the language mode is "${langId}" (Plain Text → plaintext.json). For global snippets, use a .code-snippets file.`;
          }
          void vscode.window.showInformationMessage(savedMsg);
          void currentPanel.webview.postMessage({ type: 'success' });
        } catch (e: unknown) {
          const m =
            e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not save snippet.';
          void currentPanel.webview.postMessage({ type: 'error', message: m });
        }
      }
    },
  );

  currentPanel.onDidDispose(() => {
    messageSub.dispose();
    currentPanel = undefined;
    currentPanelKind = null;
  });
}

function jsonEmbedForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function getHtml(nonce: string, csp: string, editTarget?: SnippetRecord): string {
  const editJson =
    editTarget === undefined
      ? 'null'
      : jsonEmbedForScript({
          title: editTarget.title,
          prefix: editTarget.prefix,
          description: editTarget.description,
          body: editTarget.code,
        });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${getFormStyles()}</style>
</head>
<body>
  <form id="form">
    <h1>Create snippet</h1>
    <p class="hint">By default your snippet is saved to <strong><code>code.code-snippets</code></strong> so it works in <strong>every language</strong> (Plain Text, TS, etc.). VS Code only loads global snippets from <code>.code-snippets</code> files, not <code>.snippet</code>.</p>
    <p class="hint"><strong>Language-specific only?</strong> Choose <strong>Add to existing file</strong> and pick a <code>typescript.json</code>-style file (one language id per file).</p>
    <p class="hint"><strong>Title</strong>, <strong>Prefix</strong>, and <strong>Body</strong> are required.</p>

    <label for="title">Title</label>
    <input id="title" name="title" type="text" autocomplete="off" required placeholder="e.g. Log to console" />

    <label for="prefix">Prefix (what you type for suggestions)</label>
    <input id="prefix" name="prefix" type="text" autocomplete="off" required placeholder="e.g. debug" />

    <label for="description">Description</label>
    <input id="description" name="description" type="text" autocomplete="off" placeholder="Short summary — optional" />

    <label for="body">Body</label>
    <textarea id="body" name="body" required rows="12" spellcheck="false" placeholder="Snippet text; use $1, $2 for tab stops"></textarea>

    <fieldset id="target-fieldset" class="target-fieldset">
      <legend>Save location</legend>
      <label class="radio-row">
        <input type="radio" name="targetMode" value="new" checked />
        All languages (default — <code>.code-snippets</code>)
      </label>
      <div class="new-file-row">
        <select id="rootDir" name="rootDir"></select>
        <input id="newFileName" name="newFileName" type="text" value="code.code-snippets"
          placeholder="code.code-snippets" />
      </div>

      <label class="radio-row">
        <input type="radio" name="targetMode" value="existing" />
        Specific language — add to existing <code>.json</code> file
      </label>
      <select id="existingFile" name="existingFile"></select>
    </fieldset>

    <p id="formError" class="error" role="alert" hidden></p>

    <div class="actions">
      <button type="submit" class="primary">Save snippet</button>
    </div>
  </form>
  <script nonce="${nonce}">
    var __EDIT_TARGET__ = ${editJson};
${getFormScript()}
  </script>
</body>
</html>`;
}

function getFormStyles(): string {
  return `
    :root {
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-editor-background, #1e1e1e);
      font-size: 13px;
      line-height: 1.45;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px 18px 24px;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
    h1 {
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .hint {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #9d9d9d);
      margin: 0 0 16px;
    }
    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      margin: 12px 0 4px;
      color: var(--vscode-foreground, #cccccc);
    }
    input[type="text"], textarea, select {
      width: 100%;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,.45));
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      font-family: inherit;
      font-size: 12px;
      outline: none;
    }
    textarea {
      font-family: var(--vscode-editor-font-family, monospace);
      resize: vertical;
      min-height: 140px;
    }
    input:focus, textarea:focus, select:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }
    fieldset.target-fieldset {
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
      border-radius: 8px;
      margin: 16px 0 12px;
      padding: 10px 12px 12px;
    }
    legend { font-size: 12px; font-weight: 600; padding: 0 6px; }
    .radio-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 4px;
      font-weight: 500;
      cursor: pointer;
    }
    .radio-row input { width: auto; flex-shrink: 0; }
    #existingFile { margin-bottom: 8px; }
    .new-file-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }
    .new-file-row select { flex: 1; min-width: 140px; }
    .new-file-row input { flex: 2; min-width: 160px; }
    .error {
      color: var(--vscode-errorForeground, #f88070);
      font-size: 12px;
      margin: 8px 0 0;
    }
    .actions { margin-top: 16px; }
    button.primary {
      padding: 8px 16px;
      font-size: 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    button.primary:hover { filter: brightness(1.08); }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    select:disabled, input:disabled { opacity: 0.55; }
  `;
}

function getFormScript(): string {
  return `
    var vscode = acquireVsCodeApi();
    var form = document.getElementById('form');
    var titleEl = document.getElementById('title');
    var prefixEl = document.getElementById('prefix');
    var descEl = document.getElementById('description');
    var bodyEl = document.getElementById('body');
    var existingSelect = document.getElementById('existingFile');
    var rootSelect = document.getElementById('rootDir');
    var newFileInput = document.getElementById('newFileName');
    var errEl = document.getElementById('formError');
    var roots = [];
    var modeExisting = document.querySelectorAll('input[name="targetMode"]');

    function applyEditPrefill() {
      if (typeof __EDIT_TARGET__ === 'undefined' || !__EDIT_TARGET__) return;
      var et = __EDIT_TARGET__;
      if (titleEl) titleEl.value = et.title || '';
      if (prefixEl) prefixEl.value = et.prefix || '';
      if (descEl) descEl.value = et.description || '';
      if (bodyEl) bodyEl.value = et.body || '';
      var tfs = document.getElementById('target-fieldset');
      if (tfs) tfs.style.display = 'none';
      var h1el = document.querySelector('h1');
      if (h1el) h1el.textContent = 'Edit snippet';
      var sb = document.querySelector('button[type="submit"]');
      if (sb) sb.textContent = 'Save changes';
    }
    applyEditPrefill();

    function setErr(msg) {
      if (!errEl) return;
      if (msg) { errEl.textContent = msg; errEl.hidden = false; }
      else { errEl.textContent = ''; errEl.hidden = true; }
    }

    function updateMode() {
      var mode = document.querySelector('input[name="targetMode"]:checked');
      var isExisting = mode && mode.value === 'existing';
      if (existingSelect) existingSelect.disabled = !isExisting;
      if (rootSelect) rootSelect.disabled = isExisting;
      if (newFileInput) newFileInput.disabled = isExisting;
    }

    modeExisting.forEach(function (r) {
      r.addEventListener('change', updateMode);
    });

    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'init') {
        roots = d.roots || [];
        if (existingSelect) {
          existingSelect.innerHTML = '';
          var globalFiles = d.globalFiles || [];
          var langFiles = d.langFiles || [];
          function addOptGroup(label, arr) {
            if (!arr.length) return;
            var og = document.createElement('optgroup');
            og.label = label;
            arr.forEach(function (f) {
              var o = document.createElement('option');
              o.value = f.path;
              o.textContent = f.label;
              og.appendChild(o);
            });
            existingSelect.appendChild(og);
          }
          if (!globalFiles.length && !langFiles.length) {
            var opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(no files yet — use default code.code-snippets above)';
            opt.disabled = true;
            existingSelect.appendChild(opt);
            var newRadio = document.querySelector('input[name="targetMode"][value="new"]');
            if (newRadio) newRadio.checked = true;
          } else {
            addOptGroup('Global — all languages (.code-snippets)', globalFiles);
            addOptGroup('One language only (.json)', langFiles);
          }
        }
        if (rootSelect) {
          rootSelect.innerHTML = '';
          roots.forEach(function (r) {
            var o = document.createElement('option');
            o.value = r.dir;
            o.textContent = r.label;
            rootSelect.appendChild(o);
          });
        }
        updateMode();
        return;
      }
      if (d.type === 'error' && d.message) setErr(d.message);
      if (d.type === 'success') {
        setErr('');
        if (form) form.reset();
        if (newFileInput) newFileInput.value = 'code.code-snippets';
        var newRadioReset = document.querySelector('input[name="targetMode"][value="new"]');
        if (newRadioReset) newRadioReset.checked = true;
        updateMode();
        vscode.postMessage({ type: 'ready' });
      }
    });

    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        setErr('');
        var title = (titleEl && titleEl.value || '').trim();
        var body = (bodyEl && bodyEl.value || '');
        if (!title) { setErr('Title is required.'); return; }
        var prefix = (prefixEl && prefixEl.value || '').trim();
        if (!prefix) { setErr('Prefix is required.'); return; }
        if (!body.trim()) { setErr('Body is required.'); return; }

        var isEdit = typeof __EDIT_TARGET__ !== 'undefined' && __EDIT_TARGET__;
        if (isEdit) {
          vscode.postMessage({
            type: 'submitEdit',
            title: title,
            prefix: prefix,
            description: (descEl && descEl.value) || '',
            body: body
          });
          return;
        }

        var mode = document.querySelector('input[name="targetMode"]:checked');
        var isExisting = mode && mode.value === 'existing';
        if (isExisting) {
          var fp = existingSelect && existingSelect.value;
          if (!fp) { setErr('Choose an existing snippet file or switch to New file.'); return; }
          vscode.postMessage({
            type: 'submit',
            mode: 'existing',
            title: title,
            prefix: prefix,
            description: (descEl && descEl.value) || '',
            body: body,
            filePath: fp
          });
        } else {
          var rd = rootSelect && rootSelect.value;
          var fn = (newFileInput && newFileInput.value) || '';
          if (!rd) { setErr('Choose where to create the file.'); return; }
          vscode.postMessage({
            type: 'submit',
            mode: 'new',
            title: title,
            prefix: prefix,
            description: (descEl && descEl.value) || '',
            body: body,
            rootDir: rd,
            fileName: fn
          });
        }
      });
    }

    vscode.postMessage({ type: 'ready' });
  `;
}
