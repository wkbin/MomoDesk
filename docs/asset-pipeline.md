# Asset Pipeline

MomoDesk starts with a Canvas placeholder cat. Production assets should be based on the user's own cat photos, then imported as sprite sheets once the AI asset workflow is stable.

## Workflow

1. Collect clear reference photos of the real cat.
2. Generate a consistent character sheet with `gpt-image-2`.
3. Generate each motion separately with `seedance2.0`.
4. Extract frames from each video.
5. Remove background and clean transparent edges.
6. Place every frame on a fixed 256x256 canvas.
7. Align the foot anchor at `x = 0.5`, `y = 0.92`.
8. Pack frames into a sprite sheet.
9. Register animation metadata in `assets/pets/default/pet.json`.

See `docs/pet-package.md` for the package manifest and `docs/action-assets.md` for the exact action directory names, file formats, metadata schema, and atlas output location.

## Reference Photo Checklist

Use 8-15 photos if possible:

- Front face, left side, right side, back, and three-quarter views.
- One full-body standing photo with paws visible.
- One sitting photo and one curled-up sleeping photo.
- Clear photos of special markings, eye color, tail shape, ear shape, and collar if any.
- Neutral lighting, minimal blur, and no heavy filters.

Avoid using only close-up face photos. The animation model needs body proportions, legs, paws, and tail references.

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
- The generated character should preserve the real cat's signature markings, eye color, ear shape, and tail shape.
