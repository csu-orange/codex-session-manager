# Codex Session Manager

Cross-provider Codex session manager with archive, restore, and delete support.

## Status

This repository contains the Rust + Tauri desktop app target for Windows, Linux, and macOS.

## Features

- Scan Codex sessions across providers
- View active and archived sessions together
- Filter by provider, source, location, directory, and text
- Archive sessions to `.codex/archived_sessions`
- Restore archived sessions
- Permanently delete sessions

## Project Structure

- `public/`: shared frontend assets used by the Tauri app
- `src-tauri/`: Rust backend, Tauri config, and desktop build target
- `dist/`: optional release artifact staging area
- `README-RUST-TAURI.md`: migration notes and local build prerequisites

## Local Development

Prerequisites:

- Rust toolchain
- `cargo tauri`
- Tauri platform prerequisites for your OS

Run in development mode:

```powershell
cd src-tauri
cargo tauri dev
```

Build a portable executable without installer bundling:

```powershell
cd src-tauri
cargo tauri build --no-bundle
```

On Windows, the built executable will be under:

`src-tauri/target/release/codex-session-manager.exe`

## GitHub Releases

The repository includes a GitHub Actions workflow at:

`/.github/workflows/release.yml`

It will:

- build the Tauri app on Windows, Linux, and macOS
- create or update a GitHub Release for pushed tags like `v0.1.0`
- upload platform release assets to that release

To publish a new release:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

You can also run the workflow manually from the GitHub Actions page.

## Notes

- The app reads the current user's `.codex` directory by default
- You can override the location with the `CODEX_HOME` environment variable
- Installer bundling is not required for the portable executable workflow
