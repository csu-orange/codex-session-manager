Rust + Tauri migration target

Goal:
- cross-platform desktop app for Windows / Linux / macOS
- smaller footprint than Electron
- local session management for Codex sessions

Current status:
- frontend kept in `public/`
- Rust backend moved into `src-tauri/src/main.rs`
- session listing / archive / restore / delete implemented as Tauri commands
- config in `src-tauri/tauri.conf.json`

Local prerequisites before build:
1. Install Rust toolchain
2. Install Tauri system prerequisites for your platform
3. On Windows, WebView2 runtime is usually required
4. Then run build commands from the project root

Suggested commands after Rust is installed:
- `cargo tauri dev`
- `cargo tauri build`

Notes:
- this machine currently does not have `rustc` or `cargo`
- because of that, the Rust/Tauri code was created but not compiled here
- current Node/portable version still remains available for immediate use
