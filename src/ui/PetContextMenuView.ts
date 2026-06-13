import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PetMenuItem {
  id: string;
  label: string;
  icon: string;
}

const PET_MENU_ITEMS: PetMenuItem[] = [
  { id: "feed", label: "喂食", icon: "🐟" },
  { id: "sleep", label: "睡觉", icon: "💤" },
  { id: "recall", label: "召回", icon: "🏠" },
  { id: "chat", label: "聊天", icon: "💬" },
  { id: "play", label: "看我", icon: "👋" },
  { id: "__separator__", label: "", icon: "" },
  { id: "settings", label: "设置", icon: "⚙️" },
  { id: "quit", label: "退出", icon: "🚪" }
];

export class PetContextMenuView {
  mount(target: HTMLElement): void {
    document.body.classList.add("pet-menu-window");
    target.replaceChildren(this.buildMenu());
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("blur", this.hideWindow);
  }

  private buildMenu(): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "pet-context-menu pet-context-menu--window";
    menu.setAttribute("role", "menu");

    const title = document.createElement("div");
    title.className = "pet-context-menu__title";
    title.textContent = "Momo 的小菜单";
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
}
