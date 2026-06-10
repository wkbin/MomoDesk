# Pet Package Manifest

MomoDesk uses a configuration-driven pet package model inspired by mature desktop pet frameworks such as DyberPet: each character or outfit is a folder with a manifest, action folders, and optional packed atlas output.

The goal is to let future cats and outfit packages be added without changing core app logic.

## Package Layout

```text
assets/pets/<package-id>/
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
│  ├─ eat/
│  ├─ drag/
│  └─ fall/
└─ atlas/
   ├─ cat_spritesheet.png
   └─ cat.atlas.json
```

## `pet.json`

```json
{
  "schemaVersion": 1,
  "id": "default_cat",
  "name": "Momo",
  "version": 1,
  "description": "Default placeholder cat package for MomoDesk development.",
  "author": "MomoDesk",
  "frameWidth": 256,
  "frameHeight": 256,
  "anchor": { "x": 0.5, "y": 0.92 },
  "scale": 0.65,
  "atlas": {
    "image": "atlas/cat_spritesheet.png",
    "data": "atlas/cat.atlas.json"
  },
  "behavior": {
    "defaultState": "idle",
    "dragState": "drag",
    "feedState": "eat",
    "sleepState": "sleep"
  },
  "animations": {
    "idle": {
      "fps": 8,
      "loop": true,
      "source": "actions/idle/source/idle.mp4",
      "frames": "actions/idle/frames/idle_*.png"
    }
  }
}
```

## Required Animations

Every package should define these animation keys:

```text
idle
walk_left
walk_right
sit
sit_idle
sleep
stretch
groom
eat
drag
fall
```

MVP can still render with the Canvas placeholder if real frames are missing, but production packages should provide all required actions.

## Outfit Strategy

For the current frame-animation approach, outfits should be complete pet packages:

```text
assets/pets/my_cat_default/
assets/pets/my_cat_raincoat/
assets/pets/my_cat_holiday/
```

Each outfit package should keep the same `pet.json` schema and action keys. This avoids fragile runtime clothing overlays.
