# Lume GUI

Lume GUI is an Electron desktop application for managing Lume virtual machines on Apple Silicon Macs. It provides a visual workflow for creating VMs, starting and stopping them, editing compute settings, managing shared directories, and controlling local `lume serve` behavior without working directly in the terminal for every action.

## Features

- Overview dashboard for installed VMs and current runtime status
- Create flow for macOS and Linux virtual machines
- VM details editor for CPU, memory, disk, display, headless launch, background start, and shared directories
- Global preferences for default storage, display, startup behavior, and shared directories
- Tray integration with quick access to the app and `lume serve`
- Command preview for VM creation

## Requirements

- macOS on Apple Silicon
- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- Lume CLI installed and available in `PATH`

Example Homebrew installation:

```bash
brew install trycua/tap/lume
lume --version
```

## Install Dependencies

```bash
pnpm install
```

## Start in Development

```bash
pnpm dev
```

## Build the App

```bash
pnpm build
```

Platform-specific packaging commands:

```bash
pnpm build:mac
```

## Project Structure

- `src/main`: Electron main-process code, IPC handlers, Lume integration
- `src/preload`: secure renderer bridge
- `src/renderer`: React UI
- `docs/lume-cli-guide.md`: detailed Lume CLI usage notes
- `docs/macos-adhoc-distribution.md`: ad-hoc macOS packaging and distribution notes
- `docs/macos-packaging.md`: full macOS packaging workflow
- `docs/github-actions-macos.md`: GitHub Actions automation guide
- `build`: packaged application icons and build resources

## Notes

- The GUI depends on the local Lume CLI for real VM operations.
- Headless launch and shared directory preferences are applied on future `lume run` operations.
- The app can optionally keep running in the tray after the main window is closed.
