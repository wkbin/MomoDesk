import type { Settings } from "../types/pet";

export const DEFAULT_SETTINGS: Settings = {
  autostart: false,
  soundEnabled: true,
  activeLevel: "normal",
  scale: 1,
  alwaysOnTop: true,
  skinId: "default",
  llmProvider: "deepseek",
  apiBaseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  personaPreset: "tsundere",
  customSystemPrompt: ""
};

export const LLM_PROVIDER_OPTIONS: Array<{
  value: Settings["llmProvider"];
  label: string;
  baseUrl: string;
  model: string;
}> = [
  {
    value: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  {
    value: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  {
    value: "ollama",
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b"
  },
  {
    value: "custom",
    label: "自定义兼容接口",
    baseUrl: "https://api.example.com/v1",
    model: "your-model"
  }
];

export const PERSONA_PRESET_OPTIONS: Array<{
  value: Settings["personaPreset"];
  label: string;
  intro: string;
}> = [
  {
    value: "tsundere",
    label: "傲娇",
    intro: "嘴硬心软，会关心人但不直说。"
  },
  {
    value: "clingy",
    label: "粘人",
    intro: "爱撒娇，主动接话，陪伴感更强。"
  },
  {
    value: "cool",
    label: "高冷",
    intro: "简洁克制，偶尔温柔。"
  }
];

export function getProviderDefaults(
  provider: Settings["llmProvider"]
): Pick<Settings, "apiBaseUrl" | "model"> {
  const matched = LLM_PROVIDER_OPTIONS.find((option) => option.value === provider);
  return {
    apiBaseUrl: matched?.baseUrl ?? DEFAULT_SETTINGS.apiBaseUrl,
    model: matched?.model ?? DEFAULT_SETTINGS.model
  };
}

export function getPersonaLabel(persona: Settings["personaPreset"]): string {
  return (
    PERSONA_PRESET_OPTIONS.find((option) => option.value === persona)?.label
    ?? PERSONA_PRESET_OPTIONS[0].label
  );
}
