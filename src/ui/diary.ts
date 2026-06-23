import { readPetEvents, summarizePetEvents } from "./petEvents";
import type { PetEvent, PetEventStats } from "./petEvents";

// ── Types ───────────────────────────────────────────────────────────────

export interface DiaryEntry {
  date: string; // YYYY-MM-DD
  stats: PetEventStats;
  highlights: string[];
  moodStart: number;
  moodEnd: number;
  moodTrend: "up" | "down" | "steady";
}

export interface DiaryTimeline {
  entries: DiaryEntry[];
  totalDays: number;
  totalInteractions: number;
  averageDailyInteractions: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ── Core ────────────────────────────────────────────────────────────────

export function generateDiaryEntry(date: Date): DiaryEntry {
  const events = readPetEvents();
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const today = dateKey(date);

  const dayEvents = events.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= dayStart.getTime() && ts <= dayEnd.getTime();
  });

  const stats = summarizePetEvents(events, dayEnd);

  // Mood samples for the day
  const moodSamples = dayEvents
    .filter((e) => e.type === "mood_change" && typeof e.mood === "number")
    .map((e) => ({ timestamp: Date.parse(e.timestamp), mood: e.mood ?? 50 }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const moodStart = moodSamples.length > 0 ? moodSamples[0].mood : 50;
  const moodEnd = moodSamples.length > 0 ? moodSamples[moodSamples.length - 1].mood : moodStart;
  const moodDiff = moodEnd - moodStart;
  const moodTrend: DiaryEntry["moodTrend"] =
    moodDiff > 5 ? "up" : moodDiff < -5 ? "down" : "steady";

  // Highlights
  const highlights: string[] = [];
  if (stats.todayFeeds > 0) {
    highlights.push(`你今天投喂了 Momo ${stats.todayFeeds} 次`);
  }
  if (stats.todayDrags > 0) {
    highlights.push(`你把 Momo 抱起来 ${stats.todayDrags} 次`);
  }
  if (stats.todayChatMessages > 0) {
    highlights.push(`你和 Momo 聊了 ${stats.todayChatMessages} 句话`);
  }
  if (stats.todaySleepMinutes > 10) {
    highlights.push(`Momo 睡了约 ${stats.todaySleepMinutes} 分钟`);
  }
  if (stats.todayWalkMinutes > 5) {
    highlights.push(`Momo 在桌面上散步了约 ${stats.todayWalkMinutes} 分钟`);
  }
  if (moodTrend === "up") {
    highlights.push("今天 Momo 的心情越来越好了！");
  } else if (moodTrend === "down") {
    highlights.push("今天 Momo 的心情有点低落…");
  }
  if (stats.todayInteractions === 0) {
    highlights.push("今天似乎没怎么互动，Momo 可能有点孤单");
  }

  return {
    date: today,
    stats,
    highlights,
    moodStart,
    moodEnd,
    moodTrend
  };
}

export function generateTimeline(days = 7): DiaryTimeline {
  const entries: DiaryEntry[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    entries.push(generateDiaryEntry(d));
  }

  const totalInteractions = entries.reduce((sum, e) => sum + e.stats.todayInteractions, 0);

  return {
    entries,
    totalDays: days,
    totalInteractions,
    averageDailyInteractions: days > 0 ? Math.round(totalInteractions / days) : 0
  };
}

// ── Rendering ───────────────────────────────────────────────────────────

export function renderDiaryTimeline(timeline: DiaryTimeline): string {
  if (timeline.entries.length === 0) {
    return '<div class="diary-empty">还没有陪伴记录，和 Momo 互动一下就有了 ✨</div>';
  }

  let html = '<div class="diary-timeline">';

  for (const entry of timeline.entries) {
    const trendIcon = entry.moodTrend === "up" ? "↗️" : entry.moodTrend === "down" ? "↘️" : "→";
    const trendLabel =
      entry.moodTrend === "up" ? "心情上升" : entry.moodTrend === "down" ? "心情下降" : "心情平稳";

    html += `<div class="diary-day">
      <div class="diary-day__header">
        <span class="diary-day__date">📅 ${entry.date}</span>
        <span class="diary-day__interactions">${entry.stats.todayInteractions} 次互动</span>
        <span class="diary-day__mood">${trendIcon} ${trendLabel} (${entry.moodStart}→${entry.moodEnd})</span>
      </div>`;

    if (entry.highlights.length > 0) {
      html += '<ul class="diary-day__highlights">';
      for (const h of entry.highlights) {
        html += `<li>${h}</li>`;
      }
      html += "</ul>";
    } else {
      html += '<div class="diary-day__quiet">今天 Momo 在安静陪伴你</div>';
    }

    html += "</div>";
  }

  html += "</div>";
  return html;
}

export function renderDiaryStats(timeline: DiaryTimeline): string {
  return `<div class="diary-stats">
    <div class="diary-stats__item">
      <span class="diary-stats__value">${timeline.totalDays}</span>
      <span class="diary-stats__label">统计天数</span>
    </div>
    <div class="diary-stats__item">
      <span class="diary-stats__value">${timeline.totalInteractions}</span>
      <span class="diary-stats__label">总互动次数</span>
    </div>
    <div class="diary-stats__item">
      <span class="diary-stats__value">${timeline.averageDailyInteractions}</span>
      <span class="diary-stats__label">日均互动</span>
    </div>
  </div>`;
}
