# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-06

### Added

- **Create Snippet** form (global `code.code-snippets` by default, optional language-specific `.json` files).
- **Edit** and **Delete** on each Library card; edits preserve extra snippet fields (e.g. `scope`).
- Modal confirmation before delete.

### Changed

- Snippet records carry `filePath` for reliable file updates; existing-file picker groups global vs language-specific files.

## [1.0.0] - 2026-04-06

### Added

- Side bar **Library** view listing user snippets from VS Code and Cursor `User/snippets` folders.
- Search/filter, **Insert** at cursor, **Copy** to clipboard, and **Refresh** after editing snippet files on disk.
- Command Palette commands and editor keybinding for **Search Snippets** (Windows/Linux: Ctrl+Alt+S, macOS: Cmd+Alt+S).

[1.1.0]: https://github.com/Akash-2006/vs-code-ext
[1.0.0]: https://github.com/Akash-2006/vs-code-ext
