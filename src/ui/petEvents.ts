import type { PetState } from "../types/pet";

export type PetEventType =
  | "feed"
  | "nudge"
  | "drag_start"
  | "drag_end"
  | "sleep"
  | "recall"
  | "look"
  | "state_change"
  | "mood_change"
  | "ai_mood_adjustment"
  | "proactive_bubble"
  | "chat_message";

export interface PetEvent {
  type: PetEventType;
  timestamp: string;
  state?: PetState;
  fromState?: PetState;
  toState?: PetState;
  mood?: number;
  previousMood?: number;
  delta?: number;
  reason?: string;
  message?: string;
}

export interface PetEventStats {
  todayInteractions: number;
  todayFeeds: number;
  todayDrags: number;
  todayChatMessages: number;
  todayProactiveBubbles: number;
  todaySleepMinutes: number;
  todayWalkMinutes: number;
  moodSamples: Array<{ timestamp: string; mood: number }>;
  latestAiMoodAdjustment: { delta: number; reason: string } | null;
}

export const PET_EVENTS_STORAGE_KEY = "momodesk:pet-events";
export const PET_EVENTS_UPDATED_EVENT = "momodesk:pet-events-updated";

const MAX_EVENTS = 1000;

export function recordPetEvent(event: Omit<PetEvent, "timestamp"> & { timestamp?: string }): void {
  try {
    const events = readPetEvents();
    const nextEvent: PetEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString()
    };
    events.push(nextEvent);
    const trimmed = events.slice(-MAX_EVENTS);
    window.localStorage.setItem(PET_EVENTS_STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent(PET_EVENTS_UPDATED_EVENT, { detail: nextEvent }));
  } catch {
    // Event stats are nice-to-have; interaction should never fail because localStorage did.
  }
}

export function readPetEvents(): PetEvent[] {
  try {
    const raw = window.localStorage.getItem(PET_EVENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PetEvent[];
    return Array.isArray(parsed) ? parsed.filter(isPetEvent) : [];
  } catch {
    return [];
  }
}

export function summarizePetEvents(events = readPetEvents(), now = new Date()): PetEventStats {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const nowMs = now.getTime();
  const sorted = events
    .map((event) => ({ event, timestampMs: Date.parse(event.timestamp) }))
    .filter((item) => Number.isFinite(item.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const todayEvents = sorted.filter((item) => item.timestampMs >= todayStartMs);
  const todayInteractions = todayEvents.filter((item) => isUserFacingInteraction(item.event.type)).length;

  return {
    todayInteractions,
    todayFeeds: todayEvents.filter((item) => item.event.type === "feed").length,
    todayDrags: todayEvents.filter((item) => item.event.type === "drag_start").length,
    todayChatMessages: todayEvents.filter((item) => item.event.type === "chat_message").length,
    todayProactiveBubbles: todayEvents.filter((item) => item.event.type === "proactive_bubble").length,
    todaySleepMinutes: Math.round(getStateDurationMs(sorted, "sleep", todayStartMs, nowMs) / 60_000),
    todayWalkMinutes: Math.round(getStateDurationMs(sorted, "walk", todayStartMs, nowMs) / 60_000),
    moodSamples: todayEvents
      .filter((item) => item.event.type === "mood_change" && typeof item.event.mood === "number")
      .slice(-12)
      .map((item) => ({ timestamp: item.event.timestamp, mood: item.event.mood ?? 0 })),
    latestAiMoodAdjustment: getLatestAiMoodAdjustment(todayEvents)
  };
}

function getLatestAiMoodAdjustment(
  events: Array<{ event: PetEvent; timestampMs: number }>
): PetEventStats["latestAiMoodAdjustment"] {
  const latest = events
    .filter((item) => item.event.type === "ai_mood_adjustment" && typeof item.event.delta === "number")
    .at(-1)?.event;
  if (!latest || typeof latest.delta !== "number") {
    return null;
  }

  return {
    delta: latest.delta,
    reason: latest.reason ?? "AI 校准"
  };
}

function getStateDurationMs(
  sortedEvents: Array<{ event: PetEvent; timestampMs: number }>,
  state: PetState,
  fromMs: number,
  toMs: number
): number {
  let activeSince: number | null = null;
  let total = 0;

  for (const { event, timestampMs } of sortedEvents) {
    if (timestampMs > toMs) {
      break;
    }

    if (event.type !== "state_change") {
      continue;
    }

    if (event.fromState === state && activeSince !== null) {
      total += Math.max(0, Math.min(timestampMs, toMs) - Math.max(activeSince, fromMs));
      activeSince = null;
    }

    if (event.toState === state) {
      activeSince = timestampMs;
    }
  }

  if (activeSince !== null) {
    total += Math.max(0, toMs - Math.max(activeSince, fromMs));
  }

  return total;
}

function isPetEvent(value: PetEvent): value is PetEvent {
  return Boolean(value && typeof value.type === "string" && typeof value.timestamp === "string");
}

function isUserFacingInteraction(type: PetEventType): boolean {
  return type === "nudge"
    || type === "feed"
    || type === "drag_start"
    || type === "sleep"
    || type === "look"
    || type === "chat_message"
    || type === "proactive_bubble";
}
