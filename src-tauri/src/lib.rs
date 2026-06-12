use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri::window::Color;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    autostart: bool,
    sound_enabled: bool,
    active_level: String,
    scale: f64,
    always_on_top: bool,
    skin_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autostart: false,
            sound_enabled: true,
            active_level: "normal".to_string(),
            scale: 1.0,
            always_on_top: true,
            skin_id: "default".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Vec2 {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetPersistState {
    position: Vec2,
    last_state: String,
    last_active_at: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_settings,
            load_settings,
            save_pet_state,
            load_pet_state
        ])
        .setup(|app| {
            configure_pet_window(app)?;
            build_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run MomoDesk");
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    write_json(&app, "settings.json", &settings)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Settings, String> {
    read_json(&app, "settings.json").or_else(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Ok(Settings::default())
        } else {
            Err(err.to_string())
        }
    })
}

#[tauri::command]
fn save_pet_state(app: AppHandle, state: PetPersistState) -> Result<(), String> {
    write_json(&app, "pet_state.json", &state)
}

#[tauri::command]
fn load_pet_state(app: AppHandle) -> Result<Option<PetPersistState>, String> {
    read_json(&app, "pet_state.json").map(Some).or_else(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(err.to_string())
        }
    })
}

fn configure_pet_window(app: &mut tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("pet") {
        let transparent = Color(0, 0, 0, 0);
        window.set_background_color(Some(transparent))?;
        let _ = window.set_shadow(false);
        let _ = window.set_always_on_top(true);
    }

    Ok(())
}

fn write_json<T: Serialize>(app: &AppHandle, file_name: &str, value: &T) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|err| err.to_string())?;

    let path = app_data_dir.join(file_name);
    let json = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    std::fs::write(path, json).map_err(|err| err.to_string())
}

fn read_json<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    file_name: &str,
) -> Result<T, std::io::Error> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?
        .join(file_name);
    let contents = std::fs::read_to_string(path)?;
    serde_json::from_str(&contents)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let recall_item = MenuItem::with_id(app, "recall", "召回 Momo", true, None::<&str>)?;
    let feed_item = MenuItem::with_id(app, "feed", "喂食 Momo", true, None::<&str>)?;
    let sleep_item = MenuItem::with_id(app, "sleep", "让 Momo 睡觉", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "显示 Momo", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏 Momo", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &recall_item,
            &feed_item,
            &sleep_item,
            &show_item,
            &hide_item,
            &quit_item,
        ],
    )?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "recall" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.show();
                let _ = window.center();
                let _ = window.set_focus();
                let _ = window.emit("tray-recall", ());
            }
        }
        "feed" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("tray-feed", ());
            }
        }
        "sleep" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("tray-sleep", ());
            }
        }
        "show" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "hide" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.hide();
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("pet") {
                let visible = window.is_visible().unwrap_or(false);
                if visible {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    })
    .build(app)?;

    Ok(())
}
