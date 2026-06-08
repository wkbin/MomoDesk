# MomoDesk

MomoDesk is a lightweight desktop pet prototype for a personal cat companion. The first implementation focuses on a small transparent Tauri window, a Canvas-rendered placeholder cat, basic autonomous behavior, and pointer interaction.

## Current Scope

- Vite + TypeScript frontend.
- Canvas placeholder cat with idle, walk, sit, sleep, stretch, groom, drag, and fall states.
- Browser-friendly prototype so behavior can be tested before Rust/Tauri is installed.
- Tauri 2 project files prepared for the desktop shell.

## Commands

```powershell
npm install
npm run dev
npm run build
```

After Rust and Cargo are installed:

```powershell
npm run tauri dev
```

## Asset Pipeline

The placeholder cat should later be replaced by AI-generated assets:

1. Upload clear photos of the user's own cat as the visual prototype.
2. Use `gpt-image-2` to turn those references into a consistent character sheet and static poses.
3. Use `seedance2.0` to generate short action videos based on that character sheet.
4. Extract frames, clean transparency, align foot anchors, and pack sprite sheets.
5. Register animations in `assets/pets/default/pet.json`.
