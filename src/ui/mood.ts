export interface MoodSnapshot {
  mood: number;
  label: string;
  description: string;
  state: string;
  stateLabel: string;
  profileNo: string | null;
  level: number | null;
  ageHours: number;
  growthSpeed: number | null;
  metrics: MoodMetric[];
}

export interface MoodMetric {
  id: string;
  label: string;
  value: number | null;
  tone: "green" | "cyan" | "blue" | "gold" | "pink";
  source: "live" | "pending";
}

export const MOOD_STORAGE_KEY = "momodesk:mood";
export const MOOD_UPDATED_EVENT = "momodesk:mood-updated";

const PET_FIRST_SEEN_AT_KEY = "momodesk:pet-first-seen-at";

export function clampMood(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function describeMood(value: number, state = "idle"): MoodSnapshot {
  const mood = clampMood(value);
  const base = getMoodText(mood);
  const ageHours = getAgeHours();
  const stateLabel = getStateLabel(state);

  return {
    mood,
    label: base.label,
    description: base.description,
    state,
    stateLabel,
    profileNo: null,
    level: null,
    ageHours,
    growthSpeed: null,
    metrics: [
      { id: "growth", label: "成长", value: null, tone: "green", source: "pending" },
      { id: "bond", label: "亲近", value: null, tone: "pink", source: "pending" },
      { id: "energy", label: "活力", value: null, tone: "cyan", source: "pending" },
      { id: "cleanliness", label: "清洁", value: null, tone: "blue", source: "pending" },
      { id: "health", label: "健康", value: null, tone: "green", source: "pending" },
      { id: "mood", label: "心情", value: mood, tone: "gold", source: "live" }
    ]
  };
}

function getMoodText(mood: number): Pick<MoodSnapshot, "label" | "description"> {
  if (mood < 15) {
    return {
      label: "不想理人",
      description: "Momo 现在有点闹别扭，点击可能会被无视。"
    };
  }

  if (mood < 35) {
    return {
      label: "低落",
      description: "Momo 会更想睡觉，也不太主动靠近。"
    };
  }

  if (mood < 65) {
    return {
      label: "平静",
      description: "Momo 保持日常节奏，偶尔散步或休息。"
    };
  }

  if (mood < 85) {
    return {
      label: "开心",
      description: "Momo 更愿意舔毛、伸懒腰，也更常看向你。"
    };
  }

  return {
    label: "黏人",
    description: "Momo 心情很好，可能主动走到光标附近陪你。"
  };
}

export function readStoredMood(): MoodSnapshot {
  try {
    const raw = window.localStorage.getItem(MOOD_STORAGE_KEY);
    if (!raw) {
      return describeMood(50);
    }

    const parsed = JSON.parse(raw) as Partial<MoodSnapshot>;
    return describeMood(typeof parsed.mood === "number" ? parsed.mood : 50, parsed.state);
  } catch {
    return describeMood(50);
  }
}

function getAgeHours(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  const now = Date.now();
  const stored = Number(window.localStorage.getItem(PET_FIRST_SEEN_AT_KEY));
  const firstSeenAt = Number.isFinite(stored) && stored > 0 ? stored : now;
  if (firstSeenAt === now) {
    window.localStorage.setItem(PET_FIRST_SEEN_AT_KEY, String(firstSeenAt));
  }

  return Math.max(0, Math.floor((now - firstSeenAt) / 3_600_000));
}

function getStateLabel(state: string): string {
  switch (state) {
    case "walk":
      return "散步中";
    case "sit":
      return "坐着观察";
    case "sleep":
      return "睡觉恢复";
    case "sleep_to_idle":
      return "刚醒来";
    case "eat":
      return "进食中";
    case "groom":
      return "舔毛中";
    case "stretch":
      return "伸懒腰";
    case "fall":
      return "被抱起";
    case "look":
      return "看着你";
    default:
      return "待机陪伴";
  }
}
