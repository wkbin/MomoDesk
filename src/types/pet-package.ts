import type { PetState } from "./pet";

export type AnimationKey =
  | "idle"
  | "walk_left"
  | "walk_right"
  | "sit"
  | "sit_idle"
  | "sleep"
  | "stretch"
  | "groom"
  | "eat"
  | "drag"
  | "fall";

export interface PetPackageAnchor {
  x: number;
  y: number;
}

export interface PetPackageAnimation {
  fps: number;
  loop: boolean;
  source: string;
  frames: string;
  loopStartFrame?: number;
  loopEndFrame?: number;
}

export interface PetPackageBehavior {
  defaultState: PetState;
  dragState: PetState;
  feedState: PetState;
  sleepState: PetState;
}

export interface PetPackageAtlas {
  image: string;
  data: string;
}

export interface PetPackagePreview {
  staticImage?: string;
}

export interface PetPackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: number;
  description?: string;
  author?: string;
  frameWidth: number;
  frameHeight: number;
  anchor: PetPackageAnchor;
  scale: number;
  atlas?: PetPackageAtlas;
  preview?: PetPackagePreview;
  behavior: PetPackageBehavior;
  animations: Record<AnimationKey, PetPackageAnimation>;
}

export interface PetPackageValidation {
  ok: boolean;
  missingAnimations: AnimationKey[];
}
