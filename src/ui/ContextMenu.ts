export interface ContextMenuItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
}

export interface ContextMenuOptions {
  items: ContextMenuItem[];
  onClose?: () => void;
  title?: string;
}

/** Minimum margin from viewport edges */
const EDGE_MARGIN = 4;

export class ContextMenu {
  private readonly element: HTMLDivElement;
  private readonly options: ContextMenuOptions;
  private titleEl: HTMLDivElement | null = null;
  private isOpen = false;
  private readonly closeHandler: (event: PointerEvent) => void;
  private readonly blurHandler: () => void;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor(options: ContextMenuOptions) {
    this.options = options;
    this.element = this.buildMenu();

    this.closeHandler = (event: PointerEvent) => {
      if (!this.isOpen) return;
      // Right-click should open menu, not close it
      if (event.button === 2) return;
      // If click is inside the menu, let the menu button handle it
      if (this.element.contains(event.target as Node)) return;
      this.close();
    };

    this.blurHandler = () => {
      this.close();
    };

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this.close();
      }
    };
  }

  private buildMenu(): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "pet-context-menu";
    container.style.display = "none";
    container.setAttribute("role", "menu");

    if (this.options.title) {
      this.titleEl = document.createElement("div");
      this.titleEl.className = "pet-context-menu__title pet-context-menu__title--inline";
      this.titleEl.textContent = this.options.title;
      container.appendChild(this.titleEl);
    }

    for (const item of this.options.items) {
      if (item.id === "__separator__") {
        const sep = document.createElement("div");
        sep.className = "pet-context-menu__separator";
        container.appendChild(sep);
        continue;
      }

      const button = document.createElement("button");
      button.className = "pet-context-menu__item";
      button.setAttribute("role", "menuitem");
      button.disabled = item.disabled ?? false;
      button.innerHTML = `
        <span class="pet-context-menu__icon">${item.icon}</span>
        <span class="pet-context-menu__label">${item.label}</span>
      `;
      button.addEventListener("click", () => {
        this.close();
        item.action();
      });
      container.appendChild(button);
    }

    document.body.appendChild(container);
    return container;
  }

  setTitle(title: string): void {
    if (!this.titleEl) {
      this.titleEl = document.createElement("div");
      this.titleEl.className = "pet-context-menu__title pet-context-menu__title--inline";
      this.element.prepend(this.titleEl);
    }

    this.titleEl.textContent = title;
  }

  open(x: number, y: number): void {
    this.close();

    this.isOpen = true;

    // Show off-screen to measure natural size
    const el = this.element;
    el.style.display = "block";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    el.style.opacity = "0";
    // Force layout
    void el.offsetHeight;

    // Constrain to viewport — in Tauri the viewport IS the 220×220 pet window
    const rect = el.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    // Prefer bottom-right offset so menu doesn't cover the cat
    let left = x + 12;
    let top = y + 6;

    // If menu would overflow right edge, flip to left side
    if (left + rect.width > viewW - EDGE_MARGIN) {
      left = x - rect.width - 12;
    }
    // If menu would overflow bottom edge, flip upward
    if (top + rect.height > viewH - EDGE_MARGIN) {
      top = viewH - rect.height - EDGE_MARGIN;
    }
    // Hard clamp so menu never sticks out of the viewport
    left = Math.max(EDGE_MARGIN, Math.min(left, viewW - rect.width - EDGE_MARGIN));
    top = Math.max(EDGE_MARGIN, Math.min(top, viewH - rect.height - EDGE_MARGIN));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.opacity = "1";

    // Close on outside click — capture phase fires before any canvas handler
    document.addEventListener("pointerdown", this.closeHandler, true);
    // Close when Tauri window loses focus (user clicked desktop/another window)
    window.addEventListener("blur", this.blurHandler);
    // ESC to close
    window.addEventListener("keydown", this.keyHandler);
  }

  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    const el = this.element;
    el.style.display = "none";
    el.style.opacity = "0";

    document.removeEventListener("pointerdown", this.closeHandler, true);
    window.removeEventListener("blur", this.blurHandler);
    window.removeEventListener("keydown", this.keyHandler);

    this.options.onClose?.();
  }

  destroy(): void {
    this.close();
    this.element.parentNode?.removeChild(this.element);
  }
}
