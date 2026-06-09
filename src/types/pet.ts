export type PetState =
  | "idle"
  | "walk"
  | "sit"
  | "sleep"
  | "stretch"
  | "groom"
  | "eat"
  | "drag"
  | "fall";

export type Facing = "left" | "right";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Settings {
  autostart: boolean;
  soundEnabled: boolean;
  activeLevel: string;
  scale: number;
  alwaysOnTop: boolean;
  skinId: string;
}

export interface PetPersistState {
  position: Vec2;
  lastState: PetState;
  lastActiveAt: string;
}

export interface PetModel {
  state: PetState;
  facing: Facing;
  position: Vec2;
  velocity: Vec2;
  target: Vec2;
  stateElapsedMs: number;
  nextDecisionMs: number;
}
