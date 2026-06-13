export type PetState =
  | "idle"
  | "walk"
  | "sit"
  | "sleep"
  | "sleep_to_idle"
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
  llmProvider: "deepseek" | "openai" | "ollama" | "custom";
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  petName: string;
  personaPreset: "tsundere" | "clingy" | "cool";
  memoryEnabled: boolean;
  memoryNotes: string;
  customSystemPrompt: string;
  aiMoodCalibrationEnabled: boolean;
  proactiveBubbleEnabled: boolean;
  aiProactiveBubbleEnabled: boolean;
}

export interface PetPersistState {
  position: Vec2;
  lastState: PetState;
  lastActiveAt: string;
  mood?: number;
}

export interface PetModel {
  state: PetState;
  facing: Facing;
  position: Vec2;
  velocity: Vec2;
  target: Vec2;
  stateElapsedMs: number;
  nextDecisionMs: number;
  /** 0-100, higher = happier. Decays during idle, recovers during sleep. */
  mood: number;
  /** Internal flag: when true, the next autonomous walk should head toward the cursor. */
  followMouse?: boolean;
}
