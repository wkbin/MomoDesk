import { recordPetEvent } from "./petEvents";

// ── Achievement definitions ────────────────────────────────────────────

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Which counter / condition triggers this achievement */
  condition: AchievementCondition;
  threshold: number;
}

export type AchievementCondition =
  | "feed_count"
  | "drag_count"
  | "chat_count"
  | "sleep_count"
  | "look_count"
  | "mood_peak"
  | "mood_low"
  | "consecutive_days"
  | "total_session_minutes";

export interface AchievementState {
  unlocked: string[]; // ids of unlocked achievements
  progress: Record<string, number>; // current counter values
  lastSessionDate: string; // YYYY-MM-DD of last recorded session
}

const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first_feed",
    name: "初次投喂",
    description: "第一次给 Momo 投喂小鱼干",
    icon: "🐟",
    condition: "feed_count",
    threshold: 1
  },
  {
    id: "feed_10",
    name: "投喂达人",
    description: "累计投喂 10 次",
    icon: "🍖",
    condition: "feed_count",
    threshold: 10
  },
  {
    id: "feed_50",
    name: "猫咪食堂",
    description: "累计投喂 50 次",
    icon: "🍽️",
    condition: "feed_count",
    threshold: 50
  },
  {
    id: "first_drag",
    name: "举高高",
    description: "第一次把 Momo 抱起来",
    icon: "🤗",
    condition: "drag_count",
    threshold: 1
  },
  {
    id: "drag_20",
    name: "亲密无间",
    description: "抱起 Momo 20 次",
    icon: "🫂",
    condition: "drag_count",
    threshold: 20
  },
  {
    id: "first_chat",
    name: "初次对话",
    description: "第一次和 Momo 聊天",
    icon: "💬",
    condition: "chat_count",
    threshold: 1
  },
  {
    id: "chat_30",
    name: "话痨伙伴",
    description: "和 Momo 聊天 30 次",
    icon: "📢",
    condition: "chat_count",
    threshold: 30
  },
  {
    id: "mood_95",
    name: "开心果",
    description: "Momo 的心情达到 95 以上",
    icon: "😻",
    condition: "mood_peak",
    threshold: 95
  },
  {
    id: "mood_10",
    name: "惹猫生气了",
    description: "Momo 的心情降到 10 以下",
    icon: "😾",
    condition: "mood_low",
    threshold: 10
  },
  {
    id: "sleep_3",
    name: "乖猫咪",
    description: "哄 Momo 睡觉 3 次",
    icon: "😴",
    condition: "sleep_count",
    threshold: 3
  },
  {
    id: "consecutive_3",
    name: "忠实伙伴",
    description: "连续 3 天打开 MomoDesk",
    icon: "📅",
    condition: "consecutive_days",
    threshold: 3
  },
  {
    id: "consecutive_7",
    name: "一周陪伴",
    description: "连续 7 天打开 MomoDesk",
    icon: "🏆",
    condition: "consecutive_days",
    threshold: 7
  },
  {
    id: "total_60min",
    name: "默默陪伴",
    description: "MomoDesk 累计运行 60 分钟",
    icon: "⏱️",
    condition: "total_session_minutes",
    threshold: 60
  }
];

export const ACHIEVEMENTS_BY_ID = new Map<string, AchievementDef>(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

export function getAllAchievements(): AchievementDef[] {
  return ACHIEVEMENTS;
}

// ── Persistence ────────────────────────────────────────────────────────

const STORAGE_KEY = "momodesk:achievements";

function loadState(): AchievementState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as AchievementState;
    }
  } catch {
    // corrupted — start fresh
  }
  return { unlocked: [], progress: {}, lastSessionDate: todayKey() };
}

function saveState(state: AchievementState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — silently ignore
  }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ── Public API ─────────────────────────────────────────────────────────

export type AchievementUnlockEvent = AchievementDef;

/** Subscribe to achievement unlocks. Returns unsubscribe function. */
export function onAchievementUnlocked(handler: (achievement: AchievementDef) => void): () => void {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<AchievementDef>).detail);
  };
  window.addEventListener("momodesk:achievement-unlocked", listener);
  return () => window.removeEventListener("momodesk:achievement-unlocked", listener);
}

function emitUnlock(achievement: AchievementDef): void {
  window.dispatchEvent(
    new CustomEvent<AchievementDef>("momodesk:achievement-unlocked", { detail: achievement })
  );
  recordPetEvent({
    type: "achievement_unlocked",
    message: `${achievement.icon} ${achievement.name} — ${achievement.description}`
  });
}

// ── Core logic ─────────────────────────────────────────────────────────

let _state: AchievementState | null = null;

function state(): AchievementState {
  if (!_state) {
    _state = loadState();
  }
  return _state;
}

export function getAchievementState(): Readonly<AchievementState> {
  return state();
}

/** Called once per session to record daily login streak. */
export function recordSessionStart(): void {
  const s = state();
  const today = todayKey();

  // Compute consecutive days streak
  let consecutive = 1;
  if (s.lastSessionDate) {
    const last = new Date(s.lastSessionDate);
    const now = new Date(today);
    const diffDays = Math.round((now.getTime() - last.getTime()) / 86_400_000);
    if (diffDays === 1) {
      consecutive = (s.progress.consecutive_days ?? 0) + 1;
    } else if (diffDays === 0) {
      consecutive = s.progress.consecutive_days ?? 1;
    } else {
      consecutive = 1;
    }
  }

  s.lastSessionDate = today;
  s.progress.consecutive_days = consecutive;
  saveState(s);
  check("consecutive_days", consecutive);
}

/** Increment a counter condition and check for achievement unlocks. */
export function incrementCondition(condition: AchievementCondition, amount = 1): void {
  const s = state();
  const current = (s.progress[condition] ?? 0) + amount;
  s.progress[condition] = current;
  saveState(s);
  check(condition, current);
}

/** Check a specific value-based condition (e.g. mood peak). */
export function setCondition(condition: AchievementCondition, value: number): void {
  const s = state();
  // For peak-style conditions, only update if higher (or lower for low-water-mark)
  if (condition === "mood_peak") {
    const prev = s.progress[condition] ?? 0;
    if (value <= prev) return;
  }
  if (condition === "mood_low") {
    const prev = s.progress[condition] ?? 100;
    if (value >= prev) return;
  }
  s.progress[condition] = value;
  saveState(s);
  check(condition, value);
}

function check(condition: AchievementCondition, value: number): void {
  const s = state();
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.condition !== condition) continue;
    if (s.unlocked.includes(achievement.id)) continue;
    if (value >= achievement.threshold) {
      s.unlocked.push(achievement.id);
      saveState(s);
      emitUnlock(achievement);
    }
  }
}
