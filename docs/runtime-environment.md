# Runtime And Development Environment

MomoDesk is a local desktop app. It does not require a server, database, login system, or cloud backend for the core experience.

## User Runtime Environment

End users should only need the packaged installer or executable.

| Requirement | Version / Scope | Notes |
|---|---|---|
| OS | Windows 10 21H2+ or Windows 11 | Windows is the first target platform |
| WebView runtime | Microsoft Edge WebView2 Runtime | Usually preinstalled on Windows 10/11; Tauri uses it for the UI surface |
| Network | Not required | Core pet behavior, assets, settings, and tray actions run locally |
| GPU | Integrated GPU is enough | Canvas rendering is lightweight |
| Disk | TBD, target < 100 MB installed | Depends on final sprite sheets and sound assets |
| Memory | Target < 120 MB MVP, optimize toward < 80 MB | Measured after desktop shell is running |

Users do not need to install Node.js, npm, Rust, Cargo, or any AI tools.

## Developer Environment

Developers need the web toolchain for the prototype and the Rust toolchain for the Tauri desktop shell.

| Tool | Recommended Version | Purpose |
|---|---|---|
| Node.js | 22 LTS+ or current stable | Vite, TypeScript, package scripts |
| npm | Bundled with Node.js | Dependency install and scripts |
| Rust | Stable toolchain | Tauri native layer |
| Cargo | Bundled with Rust | Rust dependency resolution and build |
| Microsoft C++ Build Tools | Latest Visual Studio Build Tools | Required by Rust/Tauri on Windows |
| WebView2 SDK/Runtime | Current | Tauri Windows webview support |
| Git | 2.40+ | Version control |

Current local validation has confirmed:

```text
npm install
npm run build
cargo check
```

`npm run tauri dev` requires Rust/Cargo and the MSVC linker to be available. If `where link` does not work in a normal terminal, run Tauri commands from a Visual Studio Developer PowerShell/Command Prompt, or initialize the environment first:

```powershell
cmd /c "call ""C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"" && cargo check"
```

## Development Commands

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
```

Use `npm run dev` for the browser-friendly Canvas prototype. Use `npm run tauri dev` when testing the transparent desktop window, tray menu, and local native persistence.

## Asset Production Environment

AI asset production is separate from the app runtime.

| Tool | Purpose | Required For Users |
|---|---|---|
| `gpt-image-2` | Generate personal cat character sheet, static poses, icons | No |
| `seedance2.0` | Generate short motion clips for actions | No |
| `ffmpeg` | Extract frames from generated videos | No |
| Image cleanup tool | Remove background, clean edges, align frames | No |
| Texture packer | Pack final frames into atlas | No |

Recommended optional tools:

- `ffmpeg` for frame extraction.
- A background removal tool for alpha cleanup.
- TexturePacker, Free Texture Packer, or an equivalent atlas tool.
- A raster editor for manual correction, such as Photoshop, Krita, Aseprite, or Photopea.

## Local Files Created By The App

MomoDesk stores lightweight local data in the platform app data directory:

```text
settings.json
pet_state.json
```

These files store user settings, the selected skin, the last pet state, and local position data. They are not synced or uploaded by default.

## No Server Requirement

The project should avoid backend services unless a future feature explicitly needs them.

Current features are local-only:

- Desktop pet rendering.
- State machine and behavior.
- Tray actions.
- Settings persistence.
- Pet state persistence.
- Asset loading.

Future online features, if ever added, should be optional and isolated from the core local app.
