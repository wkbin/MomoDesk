use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri::window::Color;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    autostart: bool,
    sound_enabled: bool,
    active_level: String,
    scale: f64,
    always_on_top: bool,
    skin_id: String,
    llm_provider: String,
    api_base_url: String,
    api_key: String,
    model: String,
    persona_preset: String,
    custom_system_prompt: String,
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
            llm_provider: "deepseek".to_string(),
            api_base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: String::new(),
            model: "deepseek-chat".to_string(),
            persona_preset: "tsundere".to_string(),
            custom_system_prompt: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatResponse {
    reply: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: String,
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
    #[serde(default = "default_mood")]
    mood: f64,
}

fn default_mood() -> f64 {
    50.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_settings,
            load_settings,
            save_pet_state,
            load_pet_state,
            chat_with_momo,
            set_click_through
        ])
        .setup(|app| {
            configure_pet_window(app)?;
            build_tray(app)?;
            // Global shortcut: Ctrl+Shift+M toggles the pet window visibility
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
            let handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if let Some(window) = handle.get_webview_window("pet") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                        if let Some(chat) = handle.get_webview_window("chat-bubble") {
                            let _ = chat.hide();
                        }
                    } else {
                        let _ = window.set_always_on_top(true);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run MomoDesk");
}

fn show_pet_window(window: &tauri::WebviewWindow, center_first: bool) {
    if center_first {
        let _ = window.center();
    }
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    write_json(&app, "settings.json", &settings)?;
    app.emit("settings-updated", &settings)
        .map_err(|err| err.to_string())?;
    Ok(())
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

#[tauri::command]
async fn chat_with_momo(
    message: String,
    recent_messages: Vec<ChatMessage>,
    settings: Settings,
) -> Result<ChatResponse, String> {
    if settings.api_base_url.trim().is_empty() {
        return Err("请先在设置里填写接口地址".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("请先在设置里填写模型名".to_string());
    }
    if settings.api_key.trim().is_empty()
        && settings.llm_provider != "ollama"
        && !settings.api_base_url.contains("127.0.0.1")
        && !settings.api_base_url.contains("localhost")
    {
        return Err("请先在设置里填写 API Key".to_string());
    }

    let system_prompt = build_system_prompt(&settings);
    let mut messages = vec![OpenAiMessage {
        role: "system",
        content: &system_prompt,
    }];

    let mut normalized_recent_messages = recent_messages;
    if normalized_recent_messages.is_empty() {
        normalized_recent_messages.push(ChatMessage {
            role: "user".to_string(),
            content: message,
        });
    }

    for item in normalized_recent_messages.iter().rev().take(6).rev() {
        messages.push(OpenAiMessage {
            role: if item.role == "assistant" {
                "assistant"
            } else {
                "user"
            },
            content: &item.content,
        });
    }

    let endpoint = format!(
        "{}/chat/completions",
        settings.api_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&ChatCompletionRequest {
            model: &settings.model,
            messages,
            temperature: 0.9,
            max_tokens: 180,
        });

    if !settings.api_key.trim().is_empty() {
        request = request.header(
            AUTHORIZATION,
            format!("Bearer {}", settings.api_key.trim()),
        );
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("模型接口请求失败（{}）：{}", status, body));
    }

    let body: ChatCompletionResponse = response.json().await.map_err(|err| err.to_string())?;
    let reply = body
        .choices
        .first()
        .map(|choice| choice.message.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "模型没有返回可用内容".to_string())?;

    Ok(ChatResponse { reply })
}

#[tauri::command]
fn set_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pet") {
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn configure_pet_window(app: &mut tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("pet") {
        let transparent = Color(0, 0, 0, 0);
        window.set_background_color(Some(transparent))?;
        let _ = window.set_shadow(false);
        let _ = window.set_always_on_top(true);
        // Inject scrollbar-hiding CSS early, before the first paint
        let _ = window.eval(
            "document.head.insertAdjacentHTML('beforeend', \
             '<style>::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}\
             html,body{scrollbar-width:none;-ms-overflow-style:none;overflow:hidden;overflow:clip;margin:0}</style>')"
        );
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
                show_pet_window(&window, true);
                let _ = window.emit("tray-recall", ());
            }
        }
        "feed" => {
            if let Some(window) = app.get_webview_window("pet") {
                show_pet_window(&window, false);
                let _ = window.emit("tray-feed", ());
            }
        }
        "sleep" => {
            if let Some(window) = app.get_webview_window("pet") {
                show_pet_window(&window, false);
                let _ = window.emit("tray-sleep", ());
            }
        }
        "show" => {
            if let Some(window) = app.get_webview_window("pet") {
                show_pet_window(&window, false);
            }
        }
        "hide" => {
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.hide();
                // Also hide the chat bubble if it's open
                if let Some(chat) = app.get_webview_window("chat-bubble") {
                    let _ = chat.hide();
                }
            }
        }
        "quit" => {
            // Notify the frontend to save state and exit gracefully
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.emit("tray-quit", ());
            }
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
                    if let Some(chat) = app.get_webview_window("chat-bubble") {
                        let _ = chat.hide();
                    }
                } else {
                    show_pet_window(&window, false);
                }
            }
        }
    })
    .build(app)?;

    Ok(())
}

fn build_system_prompt(settings: &Settings) -> String {
    let persona = match settings.persona_preset.as_str() {
        "clingy" => "你是桌宠猫猫 Momo，风格粘人、会撒娇、喜欢主动陪伴用户，但不要太吵。",
        "cool" => "你是桌宠猫猫 Momo，风格高冷、简洁、克制，偶尔流露温柔。",
        _ => "你是桌宠猫猫 Momo，风格傲娇、嘴硬心软、会关心用户但不直接承认。",
    };

    let mut prompt = String::from(persona);
    prompt.push_str(" 你的回复要像桌面旁边轻声搭话的猫，不要写成长文。");
    prompt.push_str(" 默认使用中文，每次尽量控制在 1 到 3 句话，语气自然可爱，不要使用项目符号。");
    prompt.push_str(" 如果用户是在随口问一句，就简短回应；如果用户有情绪，就先安慰再回答。");

    if !settings.custom_system_prompt.trim().is_empty() {
        prompt.push_str(" 额外要求：");
        prompt.push_str(settings.custom_system_prompt.trim());
    }

    prompt
}
