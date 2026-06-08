# MomoDesk

MomoDesk is a lightweight desktop pet prototype for a cat companion. The first implementation focuses on a small transparent Tauri window, a Canvas-rendered placeholder cat, basic autonomous behavior, and pointer interaction.

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

1. Use `gpt-image-2` to generate the consistent cat design sheet and static poses.
2. Use `seedance2.0` to generate short action videos.
3. Extract frames, clean transparency, align foot anchors, and pack sprite sheets.
4. Register animations in `assets/pets/default/pet.json`.
