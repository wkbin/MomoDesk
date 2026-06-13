import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MOOD_STORAGE_KEY, readStoredMood } from "./mood";

interface PetMenuItem {
  id: string;
  label: string;
  icon: string;
}

const PET_MENU_ITEMS: PetMenuItem[] = [
  { id: "feed", label: "投喂", icon: "🐟" },
  { id: "sleep", label: "哄睡", icon: "💤" },
  { id: "chat", label: "聊天", icon: "💬" },
  { id: "play", label: "看我", icon: "👋" }
];

export class PetContextMenuView {
  private titleEl: HTMLDivElement | null = null;
  private petName: string;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.petName = params.get("petName")?.trim() || "Momo";
  }

  mount(target: HTMLElement): void {
    document.body.classList.add("pet-menu-window");
    target.replaceChildren(this.buildMenu());
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("blur", this.hideWindow);
    window.addEventListener("storage", this.onStorageUpdated);
    window.addEventListener("focus", this.onFocus);
    if ("__TAURI_INTERNALS__" in window) {
      void listen<{ petName?: string }>("pet-menu-refresh", (event) => {
        const nextName = event.payload?.petName?.trim();
        if (nextName) {
          this.petName = nextName;
        }
        this.updateTitle();
      });
    }
  }

  private buildMenu(): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "pet-context-menu pet-context-menu--window";
    menu.setAttribute("role", "menu");

    const title = document.createElement("div");
    title.className = "pet-context-menu__title";
    this.titleEl = title;
    this.updateTitle();
    menu.appendChild(title);

    for (const item of PET_MENU_ITEMS) {
      if (item.id === "__separator__") {
        const separator = document.createElement("div");
        separator.className = "pet-context-menu__separator";
        menu.appendChild(separator);
        continue;
      }

      const button = document.createElement("button");
      button.className = "pet-context-menu__item";
      button.setAttribute("role", "menuitem");
      button.innerHTML = `
        <span class="pet-context-menu__icon">${item.icon}</span>
        <span class="pet-context-menu__label">${item.label}</span>
      `;
      button.addEventListener("click", () => {
        void this.selectItem(item.id);
      });
      menu.appendChild(button);
    }

    return menu;
  }

  private async selectItem(id: string): Promise<void> {
    await this.hideWindow();
    await emitTo("pet", "pet-menu-action", id);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      void this.hideWindow();
    }
  };

  private hideWindow = async (): Promise<void> => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    await getCurrentWindow().hide();
  };

  private onStorageUpdated = (event: StorageEvent): void => {
    if (event.key === MOOD_STORAGE_KEY) {
      this.updateTitle();
    }
  };

  private onFocus = (): void => {
    this.updateTitle();
  };

  private updateTitle(): void {
    if (!this.titleEl) {
      return;
    }

    const mood = readStoredMood();
    this.titleEl.textContent = `${this.petName} · ${mood.label} ${mood.mood}`;
  }
}
