import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ChatMessage } from "../types/chat";
import type { Settings } from "../types/pet";
import { DEFAULT_SETTINGS } from "../config/settings";
import { recordPetEvent } from "./petEvents";
import { incrementCondition } from "./achievements";
import { readStoredMood } from "./mood";

const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;
/** Max conversation turns to retain for context (backend uses last 6) */
const MAX_RECENT_MESSAGES = 6;
const CHAT_HISTORY_KEY = "momodesk:chat-history";
const CHAT_WINDOW_WIDTH = 218;
const CHAT_INPUT_HEIGHT = 64;
const CHAT_REPLY_HEIGHT = 128;
const CHAT_MEMORY_HEIGHT = 156;
const CHAT_WINDOW_GAP = 14;

interface ChatStreamToken {
  token: string;
  done: boolean;
}

export class MomoChatOverlay {
  private readonly root: HTMLElement;
  private readonly replyBubble: HTMLElement;
  private readonly replyTextEl: HTMLElement;
  private memoryPanelEl: HTMLElement | null = null;
  private readonly shell: HTMLElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;
  private readonly submitButtonEl: HTMLButtonElement;
  private settings: Settings = DEFAULT_SETTINGS;
  private busy = false;
  /** Callback invoked when the user presses ESC or clicks outside to close */
  onClose: (() => void) | null = null;
  private isStandaloneWindow = false;
  private recentMessages: ChatMessage[] = [];
  private replyDismissTimer = 0;
  private settingsUnlisten: (() => void) | null = null;
  private pending = false;

  constructor() {
    this.root = document.createElement("section");
    this.root.className = "momo-chat-inline";
    this.root.style.display = "none";
    this.loadChatHistory();

    // Reply bubble — shown above the input when AI responds
    this.replyBubble = document.createElement("div");
    this.replyBubble.className = "momo-chat-reply";
    this.replyBubble.setAttribute("aria-live", "polite");
    this.replyTextEl = document.createElement("div");
    this.replyTextEl.className = "momo-chat-reply__text";
    this.replyBubble.appendChild(this.replyTextEl);
    this.root.appendChild(this.replyBubble);

    this.shell = document.createElement("div");
    this.shell.className = "momo-chat-shell";
    this.root.appendChild(this.shell);

    this.formEl = document.createElement("form");
    this.formEl.className = "momo-chat-input";
    this.formEl.addEventListener("submit", this.handleSubmit);
    this.shell.appendChild(this.formEl);

    this.inputEl = document.createElement("input");
    this.inputEl.className = "momo-chat-input__field";
    this.inputEl.type = "text";
    this.inputEl.maxLength = 100;
    this.inputEl.placeholder = "简单问一句...";
    this.formEl.appendChild(this.inputEl);

    this.submitButtonEl = document.createElement("button");
    this.submitButtonEl.className = "momo-chat-input__send";
    this.submitButtonEl.type = "submit";
    this.submitButtonEl.textContent = "发";
    this.formEl.appendChild(this.submitButtonEl);
  }

  /** Mount into the pet container (the canvas parent) and position above the cat */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);

    const isChatWindow = new URL(window.location.href).searchParams.get("view") === "chat-bubble";
    this.isStandaloneWindow = isChatWindow;
    if (isChatWindow) {
      // Standalone chat-bubble window: use natural flow, no absolute positioning
      this.root.classList.add("momo-chat-inline--window");
      this.enterInputMode();
    } else {
      // Inline in the 220px pet window: position above the cat
      this.root.style.bottom = "160px";
    }
    this.root.style.display = "block";

    void this.loadSettings();
    this.attachSettingsSync();
    this.attachChatModeEvents();
    this.focusInputSoon();

    // Dismiss reply bubble when the user starts typing
    this.inputEl.addEventListener("input", this.onInputForReply);

    // Close on ESC
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this.close();
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    // Close on click outside
    this.outsideHandler = (event: PointerEvent) => {
      if (this.busy) return;
      if (!this.root.contains(event.target as Node)) {
        this.close();
      }
    };
    // Delay so the click that opened the chat doesn't close it
    setTimeout(() => {
      window.addEventListener("pointerdown", this.outsideHandler!);
    }, 0);
  }

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideHandler: ((e: PointerEvent) => void) | null = null;

  private readonly onInputForReply = (): void => {
    this.dismissReply();
  };

  close(): void {
    this.dismissReply();
    if (this.isStandaloneWindow) {
      // Standalone window: don't destroy DOM state — just notify to hide the window.
      // When the window is shown again, everything is still intact.
      this.onClose?.();
      return;
    }
    this.root.style.display = "none";
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.outsideHandler) {
      window.removeEventListener("pointerdown", this.outsideHandler);
      this.outsideHandler = null;
    }
    this.onClose?.();
  }

  unmount(): void {
    this.close();
    this.settingsUnlisten?.();
    this.settingsUnlisten = null;
    this.root.parentNode?.removeChild(this.root);
  }

  private readonly handleSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (this.busy) return;

    const message = this.inputEl.value.trim();
    if (!message) return;

    this.busy = true;
    this.pending = true;
    this.inputEl.value = "";
    this.inputEl.placeholder = "...";
    recordPetEvent({ type: "chat_message" });
    incrementCondition("chat_count");
    this.syncBusyState();
    // Show "..." pending state immediately
    await this.showPendingReply();

    try {
      const requestMessages = [...this.recentMessages, { role: "user" as const, content: message }];

      // Start listening for stream tokens before invoking the command
      let streamedText = "";
      let streamDone = false;
      const unlisten = await listen<ChatStreamToken>("chat-token", (event) => {
        if (streamDone) return;
        if (event.payload.done) {
          streamDone = true;
          return;
        }
        streamedText += event.payload.token;
        // Typewriter update — show tokens as they arrive
        this.replyTextEl.textContent = streamedText;
        this.replyBubble.classList.add("momo-chat-reply--visible");
        this.replyBubble.classList.remove("momo-chat-reply--pending");
      });

      await invoke("chat_with_momo_stream", {
        message,
        recentMessages: requestMessages,
        settings: this.settings
      });

      // Wait a short grace period for the final "done" event
      // Time out after 12s to avoid getting stuck if the backend stream hangs
      const STREAM_COMPLETION_TIMEOUT_MS = 12_000;
      await Promise.race([
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (streamDone) { resolve(); return; }
            setTimeout(check, 60);
          };
          check();
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, STREAM_COMPLETION_TIMEOUT_MS);
        })
      ]);

      unlisten();

      // Accumulate context for multi-turn conversation
      this.recentMessages = requestMessages;
      const reply = streamedText.trim() || "（Momo 没听清）";
      this.recentMessages.push({ role: "assistant", content: reply });
      if (this.recentMessages.length > MAX_RECENT_MESSAGES * 2) {
        this.recentMessages = this.recentMessages.slice(-MAX_RECENT_MESSAGES * 2);
      }
      this.saveChatHistory();

      // Finalize display
      this.replyTextEl.textContent = reply;
      this.replyBubble.classList.remove("momo-chat-reply--pending");
      this.replyBubble.classList.add("momo-chat-reply--visible");
      this.applyMoodStyle();
      if (this.isStandaloneWindow) {
        await this.showStandaloneWindow(false);
      }

      void this.maybeSuggestMemory(message, reply);
    } catch (error) {
      console.warn("Failed to chat with Momo", error);
      this.pending = false;
      this.inputEl.placeholder = "没接上模型，先检查 Key";
      if (this.isStandaloneWindow) {
        this.enterInputMode();
        await this.showStandaloneWindow(true);
      }
    } finally {
      this.busy = false;
      this.pending = false;
      if (this.shell.style.display !== "none") {
        this.inputEl.placeholder = "简单问一句...";
      }
      this.syncBusyState();
      if (this.shell.style.display !== "none") {
        this.focusInputSoon();
      }
      // Auto-dismiss after 8 seconds
      this.replyDismissTimer = window.setTimeout(() => {
        if (this.isStandaloneWindow) {
          this.onClose?.();
        } else {
          this.replyBubble.classList.remove("momo-chat-reply--visible");
        }
      }, 8_000);
    }
  };

  private syncBusyState(): void {
    this.inputEl.disabled = this.busy;
    this.submitButtonEl.disabled = this.busy;
    this.submitButtonEl.textContent = this.busy ? "..." : "发";
  }

  private async showReply(text: string): Promise<void> {
    window.clearTimeout(this.replyDismissTimer);
    this.enterReplyMode();
    this.clearMemoryCandidate();
    this.replyBubble.classList.remove("momo-chat-reply--pending");
    this.replyTextEl.textContent = text;
    this.replyBubble.classList.add("momo-chat-reply--visible");
    if (this.isStandaloneWindow) {
      await this.showStandaloneWindow(false);
    }
    // Auto-dismiss after 8 seconds, or when the user starts typing
    this.replyDismissTimer = window.setTimeout(() => {
      if (this.isStandaloneWindow) {
        this.onClose?.();
      } else {
        this.replyBubble.classList.remove("momo-chat-reply--visible");
      }
    }, 8000);
  }

  private dismissReply(): void {
    window.clearTimeout(this.replyDismissTimer);
    this.replyBubble.classList.remove("momo-chat-reply--visible");
    this.replyBubble.classList.remove("momo-chat-reply--pending");
    this.clearMemoryCandidate();
  }

  private focusInputSoon(): void {
    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 24);
  }

  private async loadSettings(): Promise<void> {
    if (!TAURI_AVAILABLE) {
      this.settings = DEFAULT_SETTINGS;
      return;
    }
    try {
      this.settings = await invoke<Settings>("load_settings");
    } catch {
      this.settings = DEFAULT_SETTINGS;
    }
  }

  private attachSettingsSync(): void {
    if (!TAURI_AVAILABLE) {
      return;
    }

    void listen<Settings>("settings-updated", (event) => {
      this.settings = event.payload;
    }).then((unlisten) => {
      this.settingsUnlisten?.();
      this.settingsUnlisten = unlisten;
    });
  }

  private attachChatModeEvents(): void {
    if (!TAURI_AVAILABLE || !this.isStandaloneWindow) {
      return;
    }

    void listen("chat-open-input", () => {
      this.enterInputMode();
      void this.showStandaloneWindow(true);
    });
    void listen<{ message: string }>("chat-show-proactive", (event) => {
      const message = event.payload?.message?.trim();
      if (!message) {
        return;
      }
      void this.showReply(message);
    });
  }

  private enterInputMode(): void {
    this.root.classList.remove("momo-chat-inline--reply-only");
    this.shell.style.display = "";
    this.dismissReply();
  }

  private enterReplyMode(): void {
    this.root.classList.add("momo-chat-inline--reply-only");
    this.shell.style.display = "none";
  }

  private async showStandaloneWindow(focusInput: boolean): Promise<void> {
    const window = getCurrentWindow();
    const height = this.shell.style.display === "none"
      ? (this.memoryPanelEl ? CHAT_MEMORY_HEIGHT : CHAT_REPLY_HEIGHT)
      : CHAT_INPUT_HEIGHT;
    const position = await this.getDesktopChatBubblePosition();

    await window.setSize(new LogicalSize(CHAT_WINDOW_WIDTH, height));
    await window.setPosition(new PhysicalPosition(position.x, position.y));
    await window.show();
    if (focusInput) {
      await window.setFocus();
    }
  }

  private async showPendingReply(): Promise<void> {
    this.enterReplyMode();
    this.clearMemoryCandidate();
    this.replyTextEl.textContent = "唔，让我想想…";
    this.replyBubble.classList.add("momo-chat-reply--pending");
    this.replyBubble.classList.add("momo-chat-reply--visible");
    if (this.isStandaloneWindow) {
      await this.showStandaloneWindow(false);
    }
  }

  private async maybeSuggestMemory(userMessage: string, assistantReply: string): Promise<void> {
    if (!TAURI_AVAILABLE || !this.settings.memoryEnabled || !userMessage.trim()) {
      return;
    }

    try {
      const response = await invoke<{ memory: string | null }>("suggest_memory", {
        message: userMessage,
        assistantReply,
        settings: this.settings
      });
      const memory = response.memory?.trim();
      if (!memory || this.hasExistingMemory(memory)) {
        return;
      }
      await this.showMemoryCandidate(memory);
    } catch (error) {
      console.warn("Failed to suggest memory", error);
    }
  }

  private async showMemoryCandidate(memory: string): Promise<void> {
    window.clearTimeout(this.replyDismissTimer);
    this.enterReplyMode();
    this.clearMemoryCandidate();
    this.replyBubble.classList.remove("momo-chat-reply--pending");
    this.replyBubble.classList.add("momo-chat-reply--memory");
    this.replyBubble.classList.add("momo-chat-reply--visible");

    const panel = document.createElement("div");
    panel.className = "momo-chat-memory";

    const label = document.createElement("span");
    label.className = "momo-chat-memory__text";
    label.textContent = `记住：${memory}`;
    panel.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "momo-chat-memory__actions";

    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.className = "momo-chat-memory__button momo-chat-memory__button--primary";
    acceptButton.textContent = "记住";
    acceptButton.addEventListener("click", () => {
      void this.acceptMemoryCandidate(memory);
    });
    actions.appendChild(acceptButton);

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className = "momo-chat-memory__button";
    dismissButton.textContent = "忽略";
    dismissButton.addEventListener("click", () => {
      this.clearMemoryCandidate();
      this.scheduleReplyDismiss(3000);
    });
    actions.appendChild(dismissButton);

    panel.appendChild(actions);
    this.replyBubble.appendChild(panel);
    this.memoryPanelEl = panel;

    if (this.isStandaloneWindow) {
      await this.showStandaloneWindow(false);
    }
    this.scheduleReplyDismiss(14000);
  }

  private async acceptMemoryCandidate(memory: string): Promise<void> {
    const nextMemoryNotes = this.appendMemoryNote(memory);
    const nextSettings: Settings = {
      ...this.settings,
      memoryEnabled: true,
      memoryNotes: nextMemoryNotes
    };

    try {
      await invoke("save_settings", { settings: nextSettings });
      this.settings = nextSettings;
      this.clearMemoryCandidate();
      this.replyTextEl.textContent = "好，我记住啦。";
      this.scheduleReplyDismiss(3500);
    } catch (error) {
      console.warn("Failed to save memory", error);
      this.replyTextEl.textContent = "这条记忆没存上，稍后再试。";
      this.scheduleReplyDismiss(4500);
    }

    if (this.isStandaloneWindow) {
      await this.showStandaloneWindow(false);
    }
  }

  private clearMemoryCandidate(): void {
    this.memoryPanelEl?.remove();
    this.memoryPanelEl = null;
    this.replyBubble.classList.remove("momo-chat-reply--memory");
  }

  private scheduleReplyDismiss(delayMs: number): void {
    window.clearTimeout(this.replyDismissTimer);
    this.replyDismissTimer = window.setTimeout(() => {
      if (this.isStandaloneWindow) {
        this.onClose?.();
      } else {
        this.replyBubble.classList.remove("momo-chat-reply--visible");
        this.clearMemoryCandidate();
      }
    }, delayMs);
  }

  private appendMemoryNote(memory: string): string {
    const existing = this.settings.memoryNotes.trim();
    if (!existing) {
      return `- ${memory}`;
    }

    return `${existing}\n- ${memory}`;
  }

  private hasExistingMemory(memory: string): boolean {
    const normalized = memory.replace(/\s+/g, "");
    return this.settings.memoryNotes
      .split("\n")
      .some((line) => line.replace(/^-\s*/, "").replace(/\s+/g, "") === normalized);
  }

  private async getDesktopChatBubblePosition(): Promise<{ x: number; y: number }> {
    const monitor = await currentMonitor();
    const bounds = monitor?.workArea ?? monitor;
    const petWindow = await WebviewWindow.getByLabel("pet");
    const pet = petWindow ?? getCurrentWindow();
    const [windowPosition, windowSize] = await Promise.all([
      pet.outerPosition(),
      pet.outerSize()
    ]);
    const bubbleHeight = this.shell.style.display === "none" ? CHAT_REPLY_HEIGHT : CHAT_INPUT_HEIGHT;

    const centerX = windowPosition.x + windowSize.width / 2;
    const preferRight = !bounds || centerX < bounds.position.x + bounds.size.width / 2;

    let x = preferRight
      ? windowPosition.x + windowSize.width + CHAT_WINDOW_GAP
      : windowPosition.x - CHAT_WINDOW_WIDTH - CHAT_WINDOW_GAP;
    let y = windowPosition.y + windowSize.height - bubbleHeight - 6;

    if (bounds) {
      const minX = bounds.position.x + 8;
      const maxX = bounds.position.x + bounds.size.width - CHAT_WINDOW_WIDTH - 8;
      const minY = bounds.position.y + 8;
      const maxY = bounds.position.y + bounds.size.height - bubbleHeight - 8;

      if (x < minX || x > maxX) {
        x = preferRight
          ? windowPosition.x - CHAT_WINDOW_WIDTH - CHAT_WINDOW_GAP
          : windowPosition.x + windowSize.width + CHAT_WINDOW_GAP;
      }

      x = Math.min(maxX, Math.max(minX, x));
      y = Math.min(maxY, Math.max(minY, y));
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    };
  }

  // ── Emotion expression ─────────────────────────────────────────────

  private applyMoodStyle(): void {
    const mood = readStoredMood();
    // Remove all mood classes first
    this.replyBubble.classList.remove(
      "momo-chat-reply--mood-happy",
      "momo-chat-reply--mood-calm",
      "momo-chat-reply--mood-low",
      "momo-chat-reply--mood-upset"
    );
    if (mood.mood >= 75) {
      this.replyBubble.classList.add("momo-chat-reply--mood-happy");
    } else if (mood.mood >= 45) {
      this.replyBubble.classList.add("momo-chat-reply--mood-calm");
    } else if (mood.mood >= 20) {
      this.replyBubble.classList.add("momo-chat-reply--mood-low");
    } else {
      this.replyBubble.classList.add("momo-chat-reply--mood-upset");
    }
  }

  // ── Chat history persistence ───────────────────────────────────────

  private loadChatHistory(): void {
    try {
      const raw = window.localStorage.getItem(CHAT_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) {
          this.recentMessages = parsed.slice(-MAX_RECENT_MESSAGES * 2);
        }
      }
    } catch {
      // Corrupt history — start fresh
    }
  }

  private saveChatHistory(): void {
    try {
      window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(this.recentMessages));
    } catch {
      // quota exceeded — silently ignore
    }
  }
}
