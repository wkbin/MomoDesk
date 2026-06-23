import "./styles/global.css";
import { MomoDeskApp } from "./app/MomoDeskApp";
import { MomoChatOverlay } from "./ui/MomoChatOverlay";
import { PetContextMenuView } from "./ui/PetContextMenuView";
import { SettingsView } from "./ui/SettingsView";
import { getCurrentWindow } from "@tauri-apps/api/window";

const view = new URL(window.location.href).searchParams.get("view");

if (view === "pet-menu") {
  new PetContextMenuView().mount(document.body);
} else if (view === "chat-bubble") {
  document.body.classList.add("chat-bubble-window");
  const chatOverlay = new MomoChatOverlay();
  chatOverlay.onClose = () => {
    void getCurrentWindow().hide();
  };
  chatOverlay.mount(document.body);
  // Hide window when it loses focus, but only after a short grace period
  // to avoid closing immediately when the window is first shown.
  // 300ms is chosen as a compromise: long enough to survive the show+focus
  // sequence, short enough that real blur events (user clicking away) still
  // close the window promptly.
  let blurGrace = false;
  window.addEventListener("blur", () => {
    if (blurGrace) {
      chatOverlay.close();
    }
  });
  window.setTimeout(() => { blurGrace = true; }, 300);
} else if (view === "teaser-dot") {
  // Teaser wand dot — a tiny glowing circle that follows the cursor
  const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas");
  if (canvas) canvas.style.display = "none";
  document.body.style.cssText = "margin:0;background:transparent;overflow:hidden;display:grid;place-items:center";
  const dot = document.createElement("div");
  dot.style.cssText = `
    width:22px;height:22px;border-radius:50%;
    background:radial-gradient(circle,#ffeaa7 10%,#fdcb6e 50%,transparent 70%);
    box-shadow:0 0 14px 3px rgba(253,203,110,.55),0 0 28px 6px rgba(253,203,110,.25);
  `;
  document.body.appendChild(dot);
} else if (view === "settings") {
  void new SettingsView().mount(document.body);
} else {
  const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas");

  if (!canvas) {
    throw new Error("Missing #pet-canvas");
  }

  const app = new MomoDeskApp(canvas);
  void app.start().catch((error) => {
    console.error("Failed to start MomoDesk", error);
  });
}

// Global error recovery — log but don't crash
window.addEventListener("error", (event) => {
  console.warn("[MomoDesk] unhandled error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.warn("[MomoDesk] unhandled rejection:", event.reason);
  event.preventDefault();
});
