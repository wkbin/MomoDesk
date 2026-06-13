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
