import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_SETTINGS, getProviderDefaults, LLM_PROVIDER_OPTIONS, PERSONA_PRESET_OPTIONS } from "../config/settings";
import type { Settings } from "../types/pet";
import {
  MOOD_STORAGE_KEY,
  MOOD_UPDATED_EVENT,
  type MoodMetric,
  type MoodSnapshot,
  describeMood,
  readStoredMood
} from "./mood";
import {
  PET_EVENTS_STORAGE_KEY,
  PET_EVENTS_UPDATED_EVENT,
  type PetEventStats,
  summarizePetEvents
} from "./petEvents";
import {
  generateTimeline,
  renderDiaryTimeline,
  renderDiaryStats
} from "./diary";
import type { DiaryTimeline } from "./diary";
import { getAchievementState, getAllAchievements } from "./achievements";

const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;

interface Category {
  id: string;
  label: string;
  description: string;
  buildContent: () => HTMLElement;
}

export class SettingsView {
  private settings: Settings = DEFAULT_SETTINGS;
  private formEl: HTMLFormElement | null = null;
  private saveButtonEl: HTMLButtonElement | null = null;
  private statusEl: HTMLParagraphElement | null = null;
  private activeCategory = "status";
  private readonly categoryButtons = new Map<string, HTMLButtonElement>();
  private readonly categorySections = new Map<string, HTMLElement>();
  private paneTitleEl: HTMLHeadingElement | null = null;
  private paneDescriptionEl: HTMLParagraphElement | null = null;
  private moodSnapshot: MoodSnapshot = readStoredMood();
  private petNameEl: HTMLSpanElement | null = null;
  private profileNoEl: HTMLSpanElement | null = null;
  private petLevelEl: HTMLSpanElement | null = null;
  private petAgeEl: HTMLSpanElement | null = null;
  private petStateEl: HTMLSpanElement | null = null;
  private growthSpeedEl: HTMLSpanElement | null = null;
  private companionshipEl: HTMLSpanElement | null = null;
  private moodDescriptionEl: HTMLParagraphElement | null = null;
  private metricListEl: HTMLDivElement | null = null;
  private readonly metricBars = new Map<string, { barEl: HTMLDivElement; valueEl: HTMLSpanElement }>();
  private eventStats: PetEventStats = summarizePetEvents();
  private statValueEls: Partial<Record<keyof PetEventStats | "moodTrend" | "aiMood", HTMLSpanElement>> = {};
  private diaryTimeline: DiaryTimeline = generateTimeline(7);
  private diaryDaysRange = 7;
  private diaryTimelineContainer: HTMLDivElement | null = null;
  private diaryStatsContainer: HTMLDivElement | null = null;
  private diaryPeriodSelect: HTMLSelectElement | null = null;
  private achievementProgressEl: HTMLSpanElement | null = null;
  private initialCategory: string | null = null;

  async mount(target: HTMLElement): Promise<void> {
    document.body.classList.add("settings-window");
    this.settings = await this.loadSettings();

    // Deep-link: support opening to a specific tab via ?tab=diary
    const tabParam = new URL(window.location.href).searchParams.get("tab");
    if (tabParam && this.getCategories().some(c => c.id === tabParam)) {
      this.initialCategory = tabParam;
    }

    target.replaceChildren(this.buildView());
    this.bindFormValues();
    this.bindEvents();

    // Apply initial category after the view is built (defaults to "status")
    this.setActiveCategory(this.initialCategory ?? this.activeCategory);
  }

  private buildView(): HTMLElement {
    const form = document.createElement("form");
    form.className = "settings-view";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.handleSave();
    });

    const shell = document.createElement("div");
    shell.className = "settings-shell";
    form.appendChild(shell);

    const header = document.createElement("header");
    header.className = "settings-topbar";
    header.innerHTML = `
      <div class="settings-topbar__title">
        <h1>桌宠偏好设置</h1>
        <p>调整聊天模型、角色语气和桌宠行为，让它更贴合你的桌面习惯。</p>
      </div>
      <div class="settings-topbar__meta">
        <span class="settings-topbar__badge">Desktop Pet Client</span>
      </div>
    `;
    shell.appendChild(header);

    const layout = document.createElement("div");
    layout.className = "settings-layout";
    shell.appendChild(layout);

    const sidebar = document.createElement("aside");
    sidebar.className = "settings-sidebar";
    layout.appendChild(sidebar);

    const nav = document.createElement("nav");
    nav.className = "settings-nav";
    sidebar.appendChild(nav);

    const pane = document.createElement("section");
    pane.className = "settings-pane";
    layout.appendChild(pane);

    const paneHeader = document.createElement("div");
    paneHeader.className = "settings-pane__header";
    this.paneTitleEl = document.createElement("h2");
    this.paneDescriptionEl = document.createElement("p");
    paneHeader.appendChild(this.paneTitleEl);
    paneHeader.appendChild(this.paneDescriptionEl);
    pane.appendChild(paneHeader);

    const paneBody = document.createElement("div");
    paneBody.className = "settings-pane__body";
    pane.appendChild(paneBody);

    const categories = this.getCategories();
    for (const cat of categories) {
      nav.appendChild(this.buildCategoryNavButton(cat));
      paneBody.appendChild(this.buildCategory(cat));
    }

    this.statusEl = document.createElement("p");
    this.statusEl.className = "settings-status";
    this.statusEl.textContent = "";

    this.saveButtonEl = document.createElement("button");
    this.saveButtonEl.type = "submit";
    this.saveButtonEl.className = "settings-save";
    this.saveButtonEl.textContent = "保存设置";

    const actions = document.createElement("div");
    actions.className = "settings-actions";
    actions.appendChild(this.statusEl);
    actions.appendChild(this.saveButtonEl);
    shell.appendChild(actions);

    this.formEl = form;
    return form;
  }

  private getCategories(): Category[] {
    return [
      {
        id: "status",
        label: "状态",
        description: "查看桌宠现在的心情和行为倾向。",
        buildContent: () => this.buildStatusContent()
      },
      {
        id: "diary",
        label: "日记",
        description: "查看陪伴记录和时间线。",
        buildContent: () => this.buildDiaryContent()
      },
      {
        id: "model",
        label: "模型",
        description: "选择服务提供方、接口地址和模型标识。",
        buildContent: () => this.buildModelContent()
      },
      {
        id: "persona",
        label: "人设",
        description: "控制名字、长期记忆、角色倾向和系统提示补充。",
        buildContent: () => this.buildPersonaContent()
      },
      {
        id: "behavior",
        label: "行为",
        description: "调整桌宠窗口表现、音效和显示尺寸。",
        buildContent: () => this.buildBehaviorContent()
      },
      {
        id: "advanced",
        label: "高级",
        description: "保留偏高级的扩展配置和实验项。",
        buildContent: () => this.buildAdvancedContent()
      }
    ];
  }

  private buildStatusContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    const panel = document.createElement("section");
    panel.className = "settings-pet-profile";

    const titlebar = document.createElement("div");
    titlebar.className = "settings-pet-profile__titlebar";
    const title = document.createElement("h3");
    title.textContent = "🐾 宠物档案";
    titlebar.appendChild(title);

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "settings-pet-profile__refresh";
    refreshButton.title = "刷新状态";
    refreshButton.textContent = "↻";
    refreshButton.addEventListener("click", () => {
      this.moodSnapshot = readStoredMood();
      this.eventStats = summarizePetEvents();
      this.renderMoodStatus();
      this.renderEventStats();
    });
    titlebar.appendChild(refreshButton);
    panel.appendChild(titlebar);

    const body = document.createElement("div");
    body.className = "settings-pet-profile__body";
    panel.appendChild(body);

    const info = document.createElement("div");
    info.className = "settings-pet-profile__info";
    const nameLine = this.buildProfileLine("昵称");
    this.petNameEl = nameLine.valueEl;
    nameLine.row.appendChild(this.buildEditNameButton());
    info.appendChild(nameLine.row);
    const profileLine = this.buildProfileLine("号码");
    this.profileNoEl = profileLine.valueEl;
    info.appendChild(profileLine.row);
    const levelLine = this.buildProfileLine("等级");
    this.petLevelEl = levelLine.valueEl;
    info.appendChild(levelLine.row);
    const ageLine = this.buildProfileLine("年龄");
    this.petAgeEl = ageLine.valueEl;
    info.appendChild(ageLine.row);
    body.appendChild(info);

    this.metricBars.clear();
    this.metricListEl = document.createElement("div");
    this.metricListEl.className = "settings-pet-profile__metrics";
    for (const metric of this.moodSnapshot.metrics) {
      this.metricListEl.appendChild(this.buildMetricRow(metric));
    }
    body.appendChild(this.metricListEl);

    const footer = document.createElement("div");
    footer.className = "settings-pet-profile__footer";
    const speedLine = this.buildProfileLine("成长速度");
    this.growthSpeedEl = speedLine.valueEl;
    footer.appendChild(speedLine.row);
    const companionLine = this.buildProfileLine("陪伴时长");
    this.companionshipEl = companionLine.valueEl;
    footer.appendChild(companionLine.row);
    const achievementLine = this.buildProfileLine("成就");
    this.achievementProgressEl = achievementLine.valueEl;
    footer.appendChild(achievementLine.row);
    const stateLine = this.buildProfileLine("状态");
    this.petStateEl = stateLine.valueEl;
    this.petStateEl.className = "settings-pet-profile__state";
    footer.appendChild(stateLine.row);
    body.appendChild(footer);

    this.moodDescriptionEl = document.createElement("p");
    this.moodDescriptionEl.className = "settings-pet-profile__description";
    body.appendChild(this.moodDescriptionEl);

    container.appendChild(panel);
    container.appendChild(this.buildEventStatsContent());
    this.renderMoodStatus();
    this.renderEventStats();
    return container;
  }

  private buildEventStatsContent(): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-event-stats";

    const title = document.createElement("h3");
    title.textContent = "今日记录";
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "settings-event-stats__grid";
    section.appendChild(grid);

    this.statValueEls = {};
    const stats: Array<[keyof PetEventStats | "moodTrend" | "aiMood", string]> = [
      ["todayInteractions", "互动"],
      ["todayFeeds", "喂食"],
      ["todayDrags", "拖拽"],
      ["todayChatMessages", "聊天"],
      ["todayProactiveBubbles", "主动"],
      ["todaySleepMinutes", "睡眠"],
      ["todayWalkMinutes", "散步"],
      ["moodTrend", "心情采样"],
      ["aiMood", "AI 校准"]
    ];

    for (const [key, label] of stats) {
      const item = document.createElement("div");
      item.className = "settings-event-stats__item";

      const value = document.createElement("span");
      value.className = "settings-event-stats__value";
      this.statValueEls[key] = value;
      item.appendChild(value);

      const labelEl = document.createElement("span");
      labelEl.className = "settings-event-stats__label";
      labelEl.textContent = label;
      item.appendChild(labelEl);

      grid.appendChild(item);
    }

    return section;
  }

  private buildProfileLine(labelText: string, value = ""): { row: HTMLDivElement; valueEl: HTMLSpanElement } {
    const row = document.createElement("div");
    row.className = "settings-pet-profile__line";

    const label = document.createElement("span");
    label.className = "settings-pet-profile__line-label";
    label.textContent = `${labelText}:`;
    row.appendChild(label);

    const valueEl = document.createElement("span");
    valueEl.className = "settings-pet-profile__line-value";
    valueEl.textContent = value;
    row.appendChild(valueEl);

    return { row, valueEl };
  }

  private buildEditNameButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-pet-profile__edit";
    button.textContent = "改名";
    button.addEventListener("click", () => this.focusPetNameInput());
    return button;
  }

  private focusPetNameInput(): void {
    this.setActiveCategory("persona");
    window.setTimeout(() => {
      const input = this.formEl?.querySelector<HTMLInputElement>('[name="petName"]');
      input?.focus();
      input?.select();
    }, 30);
  }

  private buildMetricRow(metric: MoodMetric): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-pet-profile__metric";
    row.dataset.metric = metric.id;

    const label = document.createElement("span");
    label.className = "settings-pet-profile__metric-label";
    label.textContent = `${metric.label}:`;
    row.appendChild(label);

    const track = document.createElement("div");
    track.className = "settings-pet-profile__metric-track";
    const bar = document.createElement("div");
    bar.className = `settings-pet-profile__metric-bar settings-pet-profile__metric-bar--${metric.tone}`;
    track.appendChild(bar);
    row.appendChild(track);

    const valueEl = document.createElement("span");
    valueEl.className = "settings-pet-profile__metric-value";
    row.appendChild(valueEl);

    this.metricBars.set(metric.id, { barEl: bar, valueEl });
    return row;
  }

  private buildCategoryNavButton(cat: Category): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-nav__item";
    button.dataset.category = cat.id;
    button.innerHTML = `
      <span class="settings-nav__label">${cat.label}</span>
      <span class="settings-nav__desc">${cat.description}</span>
    `;
    button.addEventListener("click", () => this.setActiveCategory(cat.id));
    this.categoryButtons.set(cat.id, button);
    return button;
  }

  private buildCategory(cat: Category): HTMLElement {
    const section = document.createElement("section");
    section.className = "settings-category";
    if (cat.id === "status") {
      section.classList.add("settings-category--status");
    }
    section.dataset.category = cat.id;

    const body = document.createElement("div");
    body.className = "settings-category__body";
    if (cat.id === "status") {
      body.classList.add("settings-category__body--status");
    }
    body.appendChild(cat.buildContent());
    section.appendChild(body);

    this.categorySections.set(cat.id, section);
    return section;
  }

  private buildModelContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    container.appendChild(this.buildSelectRow(
      "提供方",
      "llmProvider",
      LLM_PROVIDER_OPTIONS.map((option) => [option.value, option.label])
    ));

    container.appendChild(this.buildInputRow("接口地址", "apiBaseUrl", "https://api.deepseek.com/v1"));
    container.appendChild(this.buildInputRow("API Key", "apiKey", "sk-...", "password"));
    container.appendChild(this.buildInputRow("模型名", "model", "deepseek-chat"));
    container.appendChild(this.buildMutedHint("接口需兼容 OpenAI Chat Completions 协议。"));

    return container;
  }

  private buildPersonaContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    container.appendChild(this.buildSelectRow("人设预设", "personaPreset",
      PERSONA_PRESET_OPTIONS.map(o => [o.value, o.label])
    ));
    container.appendChild(this.buildInputRow("昵称", "petName", "Momo"));
    container.appendChild(this.buildToggleRow("启用长期记忆", "memoryEnabled"));
    container.appendChild(this.buildTextareaRow(
      "长期记忆",
      "memoryNotes",
      "比如：用户喜欢被叫阿斌；工作久坐时希望被轻轻提醒休息。"
    ));
    container.appendChild(this.buildTextareaRow(
      "补充 prompt",
      "customSystemPrompt",
      "比如：叫我主人，每次尽量 1~3 句话。"
    ));
    container.appendChild(this.buildMutedHint("长期记忆和补充 prompt 会追加到默认角色设定之后。"));
    return container;
  }

  private buildBehaviorContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    container.appendChild(this.buildToggleRow("置顶显示", "alwaysOnTop"));
    container.appendChild(this.buildToggleRow("开机自启", "autostart"));
    container.appendChild(this.buildToggleRow("启用音效", "soundEnabled"));
    container.appendChild(this.buildToggleRow("主动陪伴气泡", "proactiveBubbleEnabled"));
    container.appendChild(this.buildToggleRow("AI 生成主动话术", "aiProactiveBubbleEnabled"));
    container.appendChild(this.buildToggleRow("AI 情绪校准", "aiMoodCalibrationEnabled"));
    container.appendChild(this.buildInputRow("缩放", "scale", "1.0", "number", { min: "0.8", max: "2", step: "0.1" }));
    container.appendChild(this.buildMutedHint("主动气泡会低频出现；AI 话术开启后使用模型生成一句短话，失败时仍用本地短句。"));

    return container;
  }

  private buildAdvancedContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    container.appendChild(this.buildSelectRow("活跃度", "activeLevel", [
      ["low", "低"],
      ["normal", "中"],
      ["high", "高"]
    ]));

    container.appendChild(this.buildInputRow("当前皮肤", "skinId", "default"));

    container.appendChild(this.buildMutedHint("更多实验特性会逐步加入这个分组。"));

    return container;
  }

  private buildDiaryContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    // ── Stats summary ──
    const statsSection = document.createElement("section");
    statsSection.className = "settings-diary-section";
    const statsTitle = document.createElement("h3");
    statsTitle.textContent = "📊 陪伴统计";
    statsSection.appendChild(statsTitle);

    this.diaryStatsContainer = document.createElement("div");
    this.diaryStatsContainer.innerHTML = renderDiaryStats(this.diaryTimeline);
    statsSection.appendChild(this.diaryStatsContainer);
    container.appendChild(statsSection);

    // ── Timeline with period selector ──
    const timelineSection = document.createElement("section");
    timelineSection.className = "settings-diary-section";

    const timelineHeader = document.createElement("div");
    timelineHeader.className = "settings-diary-timeline-header";

    const timelineTitle = document.createElement("h3");
    timelineTitle.textContent = "📅 陪伴时间线";
    timelineHeader.appendChild(timelineTitle);

    this.diaryPeriodSelect = document.createElement("select");
    this.diaryPeriodSelect.className = "settings-select diary-period-select";
    const periods = [
      { value: "7", label: "最近 7 天" },
      { value: "14", label: "最近 14 天" },
      { value: "30", label: "最近 30 天" }
    ];
    for (const p of periods) {
      const opt = document.createElement("option");
      opt.value = p.value;
      opt.textContent = p.label;
      this.diaryPeriodSelect.appendChild(opt);
    }
    this.diaryPeriodSelect.value = String(this.diaryDaysRange);
    this.diaryPeriodSelect.addEventListener("change", () => this.refreshDiary());
    timelineHeader.appendChild(this.diaryPeriodSelect);

    timelineSection.appendChild(timelineHeader);

    this.diaryTimelineContainer = document.createElement("div");
    this.diaryTimelineContainer.innerHTML = renderDiaryTimeline(this.diaryTimeline);
    timelineSection.appendChild(this.diaryTimelineContainer);

    container.appendChild(timelineSection);

    return container;
  }

  private refreshDiary(): void {
    const days = parseInt(this.diaryPeriodSelect?.value ?? "7", 10);
    this.diaryDaysRange = days;
    this.diaryTimeline = generateTimeline(days);
    if (this.diaryStatsContainer) {
      this.diaryStatsContainer.innerHTML = renderDiaryStats(this.diaryTimeline);
    }
    if (this.diaryTimelineContainer) {
      this.diaryTimelineContainer.innerHTML = renderDiaryTimeline(this.diaryTimeline);
    }
  }

  // ─── Row builders ───

  private buildInputRow(
    label: string,
    name: keyof Settings,
    placeholder: string,
    type = "text",
    attrs: Record<string, string> = {}
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";

    const labelEl = document.createElement("span");
    labelEl.className = "settings-row__label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const control = document.createElement("div");
    control.className = "settings-row__control";

    const input = document.createElement("input");
    input.name = String(name);
    input.className = "settings-input";
    input.type = type;
    input.placeholder = placeholder;
    for (const [k, v] of Object.entries(attrs)) {
      input.setAttribute(k, v);
    }
    control.appendChild(input);

    row.appendChild(control);
    return row;
  }

  private buildSelectRow(
    label: string,
    name: keyof Settings,
    options: Array<[string, string]>
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";

    const labelEl = document.createElement("span");
    labelEl.className = "settings-row__label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const control = document.createElement("div");
    control.className = "settings-row__control";

    const select = document.createElement("select");
    select.name = String(name);
    select.className = "settings-select";
    for (const [value, text] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    }
    control.appendChild(select);

    row.appendChild(control);
    return row;
  }

  private buildTextareaRow(
    label: string,
    name: keyof Settings,
    placeholder: string
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-row";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.style.gap = "6px";

    const labelEl = document.createElement("span");
    labelEl.className = "settings-row__label";
    labelEl.textContent = label;
    labelEl.style.flex = "none";
    row.appendChild(labelEl);

    const textarea = document.createElement("textarea");
    textarea.name = String(name);
    textarea.className = "settings-textarea";
    textarea.placeholder = placeholder;
    row.appendChild(textarea);

    return row;
  }

  private buildToggleRow(label: string, name: keyof Settings): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-toggle";

    const labelEl = document.createElement("span");
    labelEl.className = "settings-toggle__label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const toggle = document.createElement("label");
    toggle.className = "settings-toggle__switch";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = String(name);
    toggle.appendChild(input);

    const track = document.createElement("span");
    track.className = "track";
    toggle.appendChild(track);

    row.appendChild(toggle);
    return row;
  }

  private buildMutedHint(text: string): HTMLElement {
    const hint = document.createElement("p");
    hint.className = "settings-hint";
    hint.textContent = text;
    return hint;
  }

  // ─── Form binding & save ───

  private bindFormValues(): void {
    if (!this.formEl) return;

    const set = (name: string, value: string | boolean | number) => {
      const el = this.formEl!.querySelector<HTMLElement>(`[name="${name}"]`);
      if (!el) return;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.checked = Boolean(value);
      } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        el.value = String(value);
      }
    };

    set("llmProvider", this.settings.llmProvider);
    set("apiBaseUrl", this.settings.apiBaseUrl);
    set("apiKey", this.settings.apiKey);
    set("model", this.settings.model);
    set("petName", this.getPetName());
    set("personaPreset", this.settings.personaPreset);
    set("memoryEnabled", this.settings.memoryEnabled);
    set("memoryNotes", this.settings.memoryNotes);
    set("customSystemPrompt", this.settings.customSystemPrompt);
    set("alwaysOnTop", this.settings.alwaysOnTop);
    set("autostart", this.settings.autostart);
    set("soundEnabled", this.settings.soundEnabled);
    set("proactiveBubbleEnabled", this.settings.proactiveBubbleEnabled);
    set("aiProactiveBubbleEnabled", this.settings.aiProactiveBubbleEnabled);
    set("aiMoodCalibrationEnabled", this.settings.aiMoodCalibrationEnabled);
    set("scale", this.settings.scale);
    set("activeLevel", this.settings.activeLevel);
    set("skinId", this.settings.skinId);
  }

  private bindEvents(): void {
    const provider = this.formEl?.querySelector<HTMLSelectElement>('[name="llmProvider"]');
    provider?.addEventListener("change", () => {
      const next = provider.value as Settings["llmProvider"];
      const defaults = getProviderDefaults(next);
      const apiBaseUrl = this.formEl?.querySelector<HTMLInputElement>('[name="apiBaseUrl"]');
      const model = this.formEl?.querySelector<HTMLInputElement>('[name="model"]');
      if (apiBaseUrl) apiBaseUrl.value = defaults.apiBaseUrl;
      if (model) model.value = defaults.model;
    });

    this.saveButtonEl?.addEventListener("click", () => void this.handleSave());

    if (TAURI_AVAILABLE) {
      void listen<Settings>("settings-updated", (event) => {
        this.settings = event.payload;
        this.bindFormValues();
        this.renderMoodStatus();
        this.setStatus("已同步最新设置。");
      });

      void listen<{ category: string }>("settings-navigate", (event) => {
        const { category } = event.payload;
        const categories = this.getCategories();
        if (categories.some(c => c.id === category)) {
          this.setActiveCategory(category);
        }
      });
    }

    window.addEventListener(MOOD_UPDATED_EVENT, this.onMoodUpdated);
    window.addEventListener("storage", this.onStorageUpdated);
    window.addEventListener(PET_EVENTS_UPDATED_EVENT, this.onPetEventsUpdated);
  }

  private async handleSave(): Promise<void> {
    if (!this.saveButtonEl) return;

    this.saveButtonEl.disabled = true;
    this.setStatus("正在保存...");

    const nextSettings = this.readSettings();

    try {
      await invoke("save_settings", { settings: nextSettings });
      this.settings = nextSettings;
      this.renderMoodStatus();
      this.setStatus("保存成功 ✓");
      if (TAURI_AVAILABLE) {
        window.setTimeout(() => void getCurrentWindow().setFocus(), 30);
      }
    } catch (error) {
      console.warn("Failed to save settings", error);
      this.setStatus("保存失败，检查配置是否完整。");
    } finally {
      this.saveButtonEl.disabled = false;
    }
  }

  private readSettings(): Settings {
    const g = (name: string): HTMLElement | null =>
      this.formEl?.querySelector(`[name="${name}"]`) ?? null;

    const val = (name: string): string =>
      (g(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)?.value ?? "";

    const checked = (name: string): boolean =>
      (g(name) as HTMLInputElement)?.checked ?? false;

    const num = (name: string, fallback: number): number => {
      const v = parseFloat(val(name));
      return isNaN(v) ? fallback : v;
    };

    return {
      ...this.settings,
      llmProvider: val("llmProvider") as Settings["llmProvider"],
      apiBaseUrl: val("apiBaseUrl"),
      apiKey: val("apiKey"),
      model: val("model"),
      petName: val("petName").trim() || DEFAULT_SETTINGS.petName,
      personaPreset: val("personaPreset") as Settings["personaPreset"],
      memoryEnabled: checked("memoryEnabled"),
      memoryNotes: val("memoryNotes").trim(),
      customSystemPrompt: val("customSystemPrompt"),
      alwaysOnTop: checked("alwaysOnTop"),
      autostart: checked("autostart"),
      soundEnabled: checked("soundEnabled"),
      proactiveBubbleEnabled: checked("proactiveBubbleEnabled"),
      aiProactiveBubbleEnabled: checked("aiProactiveBubbleEnabled"),
      aiMoodCalibrationEnabled: checked("aiMoodCalibrationEnabled"),
      scale: num("scale", this.settings.scale),
      activeLevel: val("activeLevel") as Settings["activeLevel"],
      skinId: val("skinId")
    };
  }

  private async loadSettings(): Promise<Settings> {
    if (!TAURI_AVAILABLE) return DEFAULT_SETTINGS;
    try {
      const settings = await invoke<Settings>("load_settings");
      try {
        const autostart = await invoke<boolean>("get_autostart");
        settings.autostart = autostart;
      } catch {
      }
      return settings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) this.statusEl.textContent = message;
  }

  private getPetName(): string {
    return this.settings.petName?.trim() || DEFAULT_SETTINGS.petName;
  }

  private onMoodUpdated = (event: Event): void => {
    const detail = (event as CustomEvent<MoodSnapshot>).detail;
    this.moodSnapshot = describeMood(detail?.mood ?? this.moodSnapshot.mood, detail?.state);
    this.renderMoodStatus();
  };

  private onStorageUpdated = (event: StorageEvent): void => {
    if (event.key === PET_EVENTS_STORAGE_KEY) {
      this.eventStats = summarizePetEvents();
      this.renderEventStats();
      return;
    }

    if (event.key === MOOD_STORAGE_KEY) {
      this.moodSnapshot = readStoredMood();
      this.renderMoodStatus();
    }
  };

  private onPetEventsUpdated = (): void => {
    this.eventStats = summarizePetEvents();
    this.renderEventStats();
  };

  private renderMoodStatus(): void {
    const mood = this.moodSnapshot;

    if (this.petNameEl) {
      this.petNameEl.textContent = this.getPetName();
    }
    if (this.profileNoEl) {
      this.profileNoEl.textContent = mood.profileNo ?? "未接入";
    }
    if (this.petLevelEl) {
      this.petLevelEl.textContent = mood.level === null
        ? "待记录"
        : `${mood.level} ${this.formatLevelBones(mood.level)}`;
    }
    if (this.petAgeEl) {
      this.petAgeEl.textContent = `本机记录 ${mood.ageHours}小时`;
    }
    if (this.growthSpeedEl) {
      this.growthSpeedEl.textContent = mood.growthSpeed === null ? "待记录" : `${mood.growthSpeed}/小时`;
    }
    if (this.companionshipEl) {
      const ageHours = mood.ageHours;
      const days = Math.floor(ageHours / 24);
      const hours = ageHours % 24;
      if (days > 0) {
        this.companionshipEl.textContent = `${days} 天 ${hours} 小时`;
      } else {
        this.companionshipEl.textContent = `${hours} 小时`;
      }
    }
    if (this.achievementProgressEl) {
      const state = getAchievementState();
      const all = getAllAchievements();
      this.achievementProgressEl.textContent = `${state.unlocked.length} / ${all.length}`;
    }
    if (this.petStateEl) {
      this.petStateEl.textContent = `${mood.stateLabel} · ${mood.label}`;
    }
    if (this.moodDescriptionEl) {
      this.moodDescriptionEl.textContent = mood.description;
    }

    for (const metric of mood.metrics) {
      const row = this.metricBars.get(metric.id);
      if (!row) {
        continue;
      }

      const value = metric.value;
      row.barEl.style.width = value === null ? "100%" : `${value}%`;
      row.barEl.classList.toggle("settings-pet-profile__metric-bar--pending", value === null);
      row.valueEl.textContent = value === null ? "未接入" : `${value}`;
      row.valueEl.classList.toggle("settings-pet-profile__metric-value--pending", value === null);
    }
  }

  private formatLevelBones(level: number): string {
    const count = Math.max(1, Math.min(5, Math.ceil(level / 8)));
    return "🦴".repeat(count);
  }

  private renderEventStats(): void {
    const stats = this.eventStats;
    this.setStatValue("todayInteractions", `${stats.todayInteractions}次`);
    this.setStatValue("todayFeeds", `${stats.todayFeeds}次`);
    this.setStatValue("todayDrags", `${stats.todayDrags}次`);
    this.setStatValue("todayChatMessages", `${stats.todayChatMessages}次`);
    this.setStatValue("todayProactiveBubbles", `${stats.todayProactiveBubbles}次`);
    this.setStatValue("todaySleepMinutes", `${stats.todaySleepMinutes}分钟`);
    this.setStatValue("todayWalkMinutes", `${stats.todayWalkMinutes}分钟`);
    this.setStatValue("moodTrend", this.formatMoodSamples(stats.moodSamples));
    this.setStatValue("aiMood", this.formatAiMoodAdjustment(stats.latestAiMoodAdjustment));
  }

  private setStatValue(key: keyof PetEventStats | "moodTrend" | "aiMood", value: string): void {
    const el = this.statValueEls[key];
    if (el) {
      el.textContent = value;
    }
  }

  private formatMoodSamples(samples: PetEventStats["moodSamples"]): string {
    if (samples.length === 0) {
      return "暂无";
    }

    const latest = samples[samples.length - 1]?.mood ?? 0;
    return `${samples.length}条 · ${latest}`;
  }

  private formatAiMoodAdjustment(adjustment: PetEventStats["latestAiMoodAdjustment"]): string {
    if (!adjustment) {
      return "暂无";
    }

    const delta = adjustment.delta > 0
      ? `+${adjustment.delta.toFixed(1)}`
      : adjustment.delta.toFixed(1);
    return `${delta} · ${adjustment.reason}`;
  }

  private setActiveCategory(categoryId: string): void {
    this.activeCategory = categoryId;
    const categories = this.getCategories();
    const active = categories.find((category) => category.id === categoryId) ?? categories[0];

    this.categoryButtons.forEach((button, id) => {
      button.classList.toggle("settings-nav__item--active", id === active.id);
    });
    this.categorySections.forEach((section, id) => {
      section.hidden = id !== active.id;
    });

    // Auto-refresh diary data when navigating to diary tab
    if (categoryId === "diary") {
      this.refreshDiary();
    }

    if (this.paneTitleEl) {
      this.paneTitleEl.textContent = active.label;
    }
    if (this.paneDescriptionEl) {
      this.paneDescriptionEl.textContent = active.description;
    }
  }
}
