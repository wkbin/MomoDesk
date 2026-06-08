# Asset Pipeline

MomoDesk starts with a Canvas placeholder cat. Production assets should be imported as sprite sheets once the AI asset workflow is stable.

## Workflow

1. Generate a consistent cat design sheet with `gpt-image-2`.
2. Generate each motion separately with `seedance2.0`.
3. Extract frames from each video.
4. Remove background and clean transparent edges.
5. Place every frame on a fixed 256x256 canvas.
6. Align the foot anchor at `x = 0.5`, `y = 0.92`.
7. Pack frames into a sprite sheet.
8. Register animation metadata in `assets/pets/default/pet.json`.

## Naming

Use predictable frame names:

```text
idle_000.png
idle_001.png
walk_right_000.png
walk_right_001.png
sleep_000.png
```

## Quality Bar

- Idle, walk, and sleep must loop cleanly.
- Fur markings should not flicker.
- Foot contact should not drift.
- The cat should still read clearly at 96px.
