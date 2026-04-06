import * as vscode from 'vscode';
import type { SnippetModel } from './snippetModel';
import { findSnippetByKey, groupSnippetsBySource } from './snippetModel';
import { copySnippetText, insertSnippetIntoActiveEditor } from './snippetProvider';
import type { SnippetRecord } from './types';

type GroupPayload = { source: string; snippets: SnippetRecord[] };

export class SnippetsWebviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'snippetsManagerView';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: SnippetModel,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const list = this.model.getSnippetList();
      if (msg?.type === 'insert' && typeof msg.source === 'string' && typeof msg.title === 'string') {
        const snippet = findSnippetByKey(list, msg.source, msg.title);
        if (snippet) {
          await insertSnippetIntoActiveEditor(snippet);
        }
        return;
      }
      if (msg?.type === 'copy' && typeof msg.source === 'string' && typeof msg.title === 'string') {
        const snippet = findSnippetByKey(list, msg.source, msg.title);
        if (snippet) {
          await copySnippetText(snippet);
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.rebuildHtml();
      }
    });

    await this.rebuildHtml();
  }

  async refreshView(): Promise<void> {
    await this.model.refresh();
    await this.rebuildHtml();
  }

  focusFilter(): void {
    if (this.view) {
      this.view.show(false);
      void this.view.webview.postMessage({ type: 'focusFilter' });
    }
  }

  private async rebuildHtml(): Promise<void> {
    await this.model.ensureLoaded();
    const groups = groupSnippetsBySource(this.model.getSnippetList());
    if (this.view) {
      this.view.webview.html = this.getHtml(this.view.webview, groups);
    }
  }

  private getHtml(webview: vscode.Webview, groups: GroupPayload[]): string {
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    const dataJson = JSON.stringify(groups)
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e')
      .replaceAll('&', '\\u0026');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${getStyles()}</style>
</head>
<body>
  <div class="toolbar">
    <input type="search" id="filter" class="filter" placeholder="Search snippets…" autocomplete="off" />
  </div>
  <div id="root" class="root"></div>
  <script nonce="${nonce}">
    var __INITIAL_DATA__ = ${dataJson};
    ${getScript()}
  </script>
</body>
</html>`;
  }
}

function getStyles(): string {
  return `
    :root {
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-sideBar-background, #252526);
      font-size: 13px;
      line-height: 1.45;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-sideBar-background, #252526);
    }

    /* --- toolbar --- */
    .toolbar {
      padding: 8px 10px 6px;
      position: sticky; top: 0; z-index: 2;
      background: var(--vscode-sideBar-background, #252526);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    }
    .filter {
      width: 100%; padding: 6px 10px; border-radius: 6px;
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,.45));
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      outline: none; font-family: inherit; font-size: 12px;
    }
    .filter:focus { border-color: var(--vscode-focusBorder, #007fd4); }
    .filter::placeholder { color: var(--vscode-input-placeholderForeground, #888); }

    /* --- container --- */
    .root { padding: 6px 8px 12px; }
    .empty {
      margin: 20px 8px; text-align: center;
      color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 12px;
    }

    /* --- file accordion --- */
    .file-group { margin-bottom: 8px; border-radius: 8px; overflow: hidden;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    }
    .file-header {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; cursor: pointer; user-select: none;
      font-weight: 600; font-size: 12px; letter-spacing: .02em;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground, #e6e6e6));
      background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.18));
    }
    .file-header:hover { filter: brightness(1.06); }
    .chevron {
      display: inline-block; width: 0; height: 0; flex-shrink: 0;
      border-left: 5px solid currentColor; border-top: 4px solid transparent;
      border-bottom: 4px solid transparent; opacity: .6;
      transition: transform .15s ease;
    }
    .file-group.open .chevron { transform: rotate(90deg); }
    .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #ffffff);
    }
    .file-body {
      display: none; padding: 6px 8px 8px;
      flex-direction: column; gap: 6px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    }
    .file-group.open .file-body { display: flex; }

    /* --- snippet card --- */
    .snippet-card {
      border-radius: 6px; padding: 8px 10px;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .snippet-card.hidden { display: none; }
    .snippet-card:hover { border-color: var(--vscode-focusBorder, rgba(0,127,212,.45)); }
    .row-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-bottom: 4px; }
    .prefix-pill {
      font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
      padding: 2px 8px; border-radius: 4px;
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      color: var(--vscode-textPreformat-foreground, #d4d4d4);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    }
    .snippet-title { font-weight: 600; font-size: 13px; color: var(--vscode-foreground, #e6e6e6); }
    .snippet-desc {
      font-size: 11px; margin: 0 0 4px; line-height: 1.35;
      color: var(--vscode-descriptionForeground, #9d9d9d);
    }
    .preview-toggle {
      cursor: pointer; font-size: 11px; padding: 2px 0; user-select: none;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .preview-toggle:hover { text-decoration: underline; }
    .preview-code {
      display: none; margin: 6px 0 0; padding: 8px; border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
      line-height: 1.4; white-space: pre-wrap; word-break: break-word; max-height: 160px;
      overflow-y: auto;
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      color: var(--vscode-editor-foreground, #d4d4d4);
    }
    .preview-code.show { display: block; }
    .actions { display: flex; gap: 6px; margin-top: 6px; }
    .actions button {
      flex: 1; padding: 5px 10px; font-size: 11px; font-family: inherit;
      border-radius: 4px; border: none; cursor: pointer;
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    .actions button.primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    .actions button:hover { filter: brightness(1.1); }
  `;
}

function getScript(): string {
  return `
(function () {
  var vscode = acquireVsCodeApi();
  var root = document.getElementById('root');
  var filterInput = document.getElementById('filter');

  // ---- listen for extension messages (focusFilter on Search command) ----
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'focusFilter' && filterInput) {
      filterInput.focus();
      filterInput.select();
    }
  });

  // ---- render initial data embedded in the HTML ----
  render(window.__INITIAL_DATA__ || []);

  // ---- filter ----
  if (filterInput) {
    filterInput.addEventListener('input', function () {
      applyFilter(filterInput.value.trim());
    });
  }

  function applyFilter(q) {
    if (!root) return;
    var lq = q.toLowerCase();
    var cards = root.querySelectorAll('.snippet-card');
    var groups = root.querySelectorAll('.file-group');

    cards.forEach(function (card) {
      var hay = (card.getAttribute('data-search') || '').toLowerCase();
      var match = !q || hay.indexOf(lq) !== -1;
      card.classList.toggle('hidden', !match);
    });

    groups.forEach(function (group) {
      var hasVisible = group.querySelector('.snippet-card:not(.hidden)');
      group.style.display = (q && !hasVisible) ? 'none' : '';
      if (q && hasVisible) group.classList.add('open');
    });
  }

  function render(groups) {
    if (!root) return;
    root.innerHTML = '';

    if (!groups || !groups.length) {
      root.innerHTML = '<p class="empty">No snippets found.<br>Add snippet files under <b>User/snippets</b>, then click <b>Refresh</b>.</p>';
      return;
    }

    for (var i = 0; i < groups.length; i++) {
      root.appendChild(buildFileGroup(groups[i]));
    }
  }

  function buildFileGroup(g) {
    var wrap = document.createElement('div');
    wrap.className = 'file-group open';

    var header = document.createElement('div');
    header.className = 'file-header';
    header.innerHTML = '<span class="chevron"></span><span class="file-name"></span><span class="badge"></span>';
    header.querySelector('.file-name').textContent = g.source;
    header.querySelector('.badge').textContent = String(g.snippets.length);
    header.addEventListener('click', function () { wrap.classList.toggle('open'); });
    wrap.appendChild(header);

    var body = document.createElement('div');
    body.className = 'file-body';
    for (var j = 0; j < g.snippets.length; j++) {
      body.appendChild(buildCard(g.snippets[j]));
    }
    wrap.appendChild(body);
    return wrap;
  }

  function buildCard(s) {
    var card = document.createElement('div');
    card.className = 'snippet-card';
    card.setAttribute('data-search', [s.title, s.prefix, s.description, s.code].join(' '));

    var top = document.createElement('div');
    top.className = 'row-top';
    if (s.prefix) {
      var pill = document.createElement('span');
      pill.className = 'prefix-pill';
      pill.textContent = s.prefix;
      top.appendChild(pill);
    }
    var title = document.createElement('span');
    title.className = 'snippet-title';
    title.textContent = s.title;
    top.appendChild(title);
    card.appendChild(top);

    if (s.description) {
      var desc = document.createElement('p');
      desc.className = 'snippet-desc';
      desc.textContent = s.description;
      card.appendChild(desc);
    }

    var preCode = document.createElement('pre');
    preCode.className = 'preview-code';
    preCode.textContent = s.code || '';

    var toggle = document.createElement('div');
    toggle.className = 'preview-toggle';
    toggle.textContent = '▸ Show body';
    toggle.addEventListener('click', function () {
      var open = preCode.classList.toggle('show');
      toggle.textContent = open ? '▾ Hide body' : '▸ Show body';
    });
    card.appendChild(toggle);
    card.appendChild(preCode);

    var actions = document.createElement('div');
    actions.className = 'actions';

    var ins = document.createElement('button');
    ins.className = 'primary'; ins.type = 'button'; ins.textContent = 'Insert';
    ins.addEventListener('click', function (e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'insert', source: s.source, title: s.title });
    });

    var cp = document.createElement('button');
    cp.type = 'button'; cp.textContent = 'Copy';
    cp.addEventListener('click', function (e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'copy', source: s.source, title: s.title });
    });

    actions.appendChild(ins);
    actions.appendChild(cp);
    card.appendChild(actions);
    return card;
  }
})();
`;
}
