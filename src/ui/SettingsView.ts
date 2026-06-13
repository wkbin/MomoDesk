import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_SETTINGS, getProviderDefaults, LLM_PROVIDER_OPTIONS, PERSONA_PRESET_OPTIONS } from "../config/settings";
import type { Settings } from "../types/pet";

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
  private activeCategory = "model";
  private readonly categoryButtons = new Map<string, HTMLButtonElement>();
  private readonly categorySections = new Map<string, HTMLElement>();
  private paneTitleEl: HTMLHeadingElement | null = null;
  private paneDescriptionEl: HTMLParagraphElement | null = null;

  async mount(target: HTMLElement): Promise<void> {
    document.body.classList.add("settings-window");
    this.settings = await this.loadSettings();
    target.replaceChildren(this.buildView());
    this.bindFormValues();
    this.bindEvents();
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
        <h1>Momo 偏好设置</h1>
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
    this.setActiveCategory(this.activeCategory);
    return form;
  }

  private getCategories(): Category[] {
    return [
      {
        id: "model",
        label: "模型",
        description: "选择服务提供方、接口地址和模型标识。",
        buildContent: () => this.buildModelContent()
      },
      {
        id: "persona",
        label: "人设",
        description: "控制 Momo 的语气、角色倾向和系统提示补充。",
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
    section.dataset.category = cat.id;

    const body = document.createElement("div");
    body.className = "settings-category__body";
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

    const textRow = document.createElement("div");
    textRow.className = "settings-row";
    textRow.style.flexDirection = "column";
    textRow.style.alignItems = "stretch";
    textRow.style.gap = "6px";

    const label = document.createElement("span");
    label.className = "settings-row__label";
    label.textContent = "补充 prompt";
    label.style.flex = "none";
    textRow.appendChild(label);

    const textarea = document.createElement("textarea");
    textarea.name = "customSystemPrompt";
    textarea.className = "settings-textarea";
    textarea.placeholder = "比如：叫我主人，每次尽量 1~3 句话。";
    textRow.appendChild(textarea);

    container.appendChild(textRow);
    container.appendChild(this.buildMutedHint("额外 prompt 会追加到默认角色设定之后。"));
    return container;
  }

  private buildBehaviorContent(): HTMLElement {
    const container = document.createElement("div");
    container.className = "settings-group";

    container.appendChild(this.buildToggleRow("置顶显示", "alwaysOnTop"));
    container.appendChild(this.buildToggleRow("启用音效", "soundEnabled"));
    container.appendChild(this.buildInputRow("缩放", "scale", "1.0", "number", { min: "0.8", max: "2", step: "0.1" }));
    container.appendChild(this.buildMutedHint("缩放会影响桌宠窗口大小和可交互区域。"));

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
    set("personaPreset", this.settings.personaPreset);
    set("customSystemPrompt", this.settings.customSystemPrompt);
    set("alwaysOnTop", this.settings.alwaysOnTop);
    set("soundEnabled", this.settings.soundEnabled);
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
        this.setStatus("已同步最新设置。");
      });
    }
  }

  private async handleSave(): Promise<void> {
    if (!this.saveButtonEl) return;

    this.saveButtonEl.disabled = true;
    this.setStatus("正在保存...");

    const nextSettings = this.readSettings();

    try {
      await invoke("save_settings", { settings: nextSettings });
      this.settings = nextSettings;
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
      personaPreset: val("personaPreset") as Settings["personaPreset"],
      customSystemPrompt: val("customSystemPrompt"),
      alwaysOnTop: checked("alwaysOnTop"),
      soundEnabled: checked("soundEnabled"),
      scale: num("scale", this.settings.scale),
      activeLevel: val("activeLevel") as Settings["activeLevel"],
      skinId: val("skinId")
    };
  }

  private async loadSettings(): Promise<Settings> {
    if (!TAURI_AVAILABLE) return DEFAULT_SETTINGS;
    try {
      return await invoke<Settings>("load_settings");
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) this.statusEl.textContent = message;
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

    if (this.paneTitleEl) {
      this.paneTitleEl.textContent = active.label;
    }
    if (this.paneDescriptionEl) {
      this.paneDescriptionEl.textContent = active.description;
    }
  }
}
