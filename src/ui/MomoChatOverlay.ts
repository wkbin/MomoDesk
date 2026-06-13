import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ChatResponse, ChatMessage } from "../types/chat";
import type { Settings } from "../types/pet";
import { DEFAULT_SETTINGS } from "../config/settings";

const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;
/** Max conversation turns to retain for context (backend uses last 6) */
const MAX_RECENT_MESSAGES = 6;
const CHAT_WINDOW_WIDTH = 218;
const CHAT_INPUT_HEIGHT = 64;
const CHAT_REPLY_HEIGHT = 128;
const CHAT_WINDOW_GAP = 14;

export class MomoChatOverlay {
  private readonly root: HTMLElement;
  private readonly replyBubble: HTMLElement;
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

    // Reply bubble — shown above the input when AI responds
    this.replyBubble = document.createElement("div");
    this.replyBubble.className = "momo-chat-reply";
    this.replyBubble.setAttribute("aria-live", "polite");
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
    this.syncBusyState();
    await this.showPendingReply();

    try {
      const requestMessages = [...this.recentMessages, { role: "user" as const, content: message }];
      const response = await invoke<ChatResponse>("chat_with_momo", {
        message,
        recentMessages: requestMessages,
        settings: this.settings
      });
      // Accumulate context for multi-turn conversation
      this.recentMessages = requestMessages;
      this.recentMessages.push({ role: "assistant", content: response.reply });
      // Keep only the last N turns so the array doesn't grow unbounded
      if (this.recentMessages.length > MAX_RECENT_MESSAGES * 2) {
        this.recentMessages = this.recentMessages.slice(-MAX_RECENT_MESSAGES * 2);
      }
      await this.showReply(response.reply);
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
    this.replyBubble.classList.remove("momo-chat-reply--pending");
    this.replyBubble.textContent = text;
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
    const height = this.shell.style.display === "none" ? CHAT_REPLY_HEIGHT : CHAT_INPUT_HEIGHT;
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
    this.replyBubble.textContent = "唔，让我想想…";
    this.replyBubble.classList.add("momo-chat-reply--pending");
    this.replyBubble.classList.add("momo-chat-reply--visible");
    if (this.isStandaloneWindow) {
      await this.showStandaloneWindow(false);
    }
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
}
