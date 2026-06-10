# Cat Action Asset Directory Spec

This document defines where each MomoDesk cat action asset should live and which formats are expected. See `docs/pet-package.md` for the package-level manifest.

## Root Layout

```text
assets/pets/default/
├─ pet.json
├─ actions/
│  ├─ idle/
│  ├─ walk_left/
│  ├─ walk_right/
│  ├─ sit/
│  ├─ sit_idle/
│  ├─ sleep/
│  ├─ stretch/
│  ├─ groom/
│  ├─ drag/
│  ├─ fall/
│  └─ eat/
└─ atlas/
   ├─ cat_spritesheet.png
   └─ cat.atlas.json
```

Each action folder should use this internal layout:

```text
assets/pets/default/actions/<action>/
├─ source/
│  └─ <action>.mp4
├─ frames/
│  ├─ <action>_000.png
│  ├─ <action>_001.png
│  └─ ...
├─ preview/
│  └─ <action>.webp
├─ metadata.json
└─ notes.md
```

## Folder Purpose

| Folder | Contents | Commit rule |
|---|---|---|
| `source/` | Seedance source videos, usually `.mp4` | Commit only curated final clips |
| `frames/` | Clean transparent animation frames | Commit production-ready frames or pack them into atlas |
| `preview/` | Small loop preview for review, `.webp` or `.gif` | Safe to commit if small |
| `metadata.json` | Per-action animation settings | Commit |
| `notes.md` | Prompt, cleanup notes, known issues | Commit |
| `atlas/` | Packed sprite sheet and atlas JSON | Commit final app assets |

## Required Actions

| Action | Directory | Source format | Frame format | FPS | Loop | Notes |
|---|---|---|---|---:|---|---|
| Idle breathing | `idle/` | `idle.mp4` | `idle_000.png` | 6-8 | Yes | Subtle breathing and tail motion |
| Walk left | `walk_left/` | `walk_left.mp4` | `walk_left_000.png` | 10-12 | Yes | Side view, stable paw contact |
| Walk right | `walk_right/` | `walk_right.mp4` | `walk_right_000.png` | 10-12 | Yes | Can be generated or mirrored from left |
| Sit transition | `sit/` | `sit.mp4` | `sit_000.png` | 8-10 | No | Stand-to-sit transition |
| Sitting idle | `sit_idle/` | `sit_idle.mp4` | `sit_idle_000.png` | 5-6 | Yes | Calm sitting loop |
| Sleep | `sleep/` | `sleep.mp4` | `sleep_000.png` | 3-5 | Yes | Curled or lying breathing loop |
| Stretch | `stretch/` | `stretch.mp4` | `stretch_000.png` | 10-12 | No | One-shot animation |
| Groom | `groom/` | `groom.mp4` | `groom_000.png` | 8-10 | Yes | Licking paw or fur |
| Drag | `drag/` | `drag.mp4` | `drag_000.png` | 6-8 | Yes | Held pose while being dragged |
| Fall | `fall/` | `fall.mp4` | `fall_000.png` | 10-12 | No | Release/drop animation |
| Eat | `eat/` | `eat.mp4` | `eat_000.png` | 8-10 | No or Yes | Triggered by tray feed |

## Image Frame Format

Use this format for all extracted and cleaned frames:

- PNG with alpha channel.
- 256x256 canvas for MVP assets.
- Transparent background.
- File names are zero-padded: `<action>_000.png`, `<action>_001.png`.
- Foot anchor aligns to `x = 0.5`, `y = 0.92`.
- Character scale and floor contact should stay stable across frames.

WebP is allowed only for previews or packed production sheets. Keep intermediate frames as PNG while cleaning and aligning.

## Privacy And Git Rules

`source/` folders are ignored by Git by default because generated videos may be large or derived from private cat references. Keep source videos locally unless you intentionally decide to version a curated clip.

Tracked files in each action folder should usually be:

- `.gitkeep` placeholders.
- `metadata.json`.
- Optional `notes.md`.
- Small `preview/*.webp` files.
- Final `frames/*.png` only when they are approved or needed before atlas packing.

## Video Source Format

Preferred Seedance export:

- `.mp4`
- 1-2 seconds per action.
- 24 or 30 FPS source video.
- Fixed camera.
- Full cat body visible.
- Transparent background if available; otherwise solid green or blue background for keying.
- No camera zoom, pan, text, props, or environment changes unless the action requires a prop.

## `metadata.json` Format

Each action can include a `metadata.json` file:

```json
{
  "action": "idle",
  "fps": 8,
  "loop": true,
  "frameWidth": 256,
  "frameHeight": 256,
  "anchor": { "x": 0.5, "y": 0.92 },
  "source": "source/idle.mp4",
  "frames": "frames/idle_*.png",
  "preview": "preview/idle.webp",
  "notes": "Generated from personal cat reference sheet v1."
}
```

## Packing To Atlas

After frames are cleaned and approved, pack them into:

```text
assets/pets/default/atlas/cat_spritesheet.png
assets/pets/default/atlas/cat.atlas.json
```

Then update:

```text
assets/pets/default/pet.json
```

The runtime should eventually read `pet.json` first, then load the atlas and animation metadata from there.
