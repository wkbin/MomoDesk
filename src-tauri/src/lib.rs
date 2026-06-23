use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
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
    #[serde(default = "default_pet_name")]
    pet_name: String,
    persona_preset: String,
    #[serde(default = "default_true")]
    memory_enabled: bool,
    #[serde(default)]
    memory_notes: String,
    custom_system_prompt: String,
    #[serde(default)]
    ai_mood_calibration_enabled: bool,
    #[serde(default = "default_true")]
    proactive_bubble_enabled: bool,
    #[serde(default)]
    ai_proactive_bubble_enabled: bool,
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
            pet_name: default_pet_name(),
            persona_preset: "tsundere".to_string(),
            memory_enabled: true,
            memory_notes: String::new(),
            custom_system_prompt: String::new(),
            ai_mood_calibration_enabled: false,
            proactive_bubble_enabled: true,
            ai_proactive_bubble_enabled: false,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_pet_name() -> String {
    "Momo".to_string()
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemorySuggestionResponse {
    memory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodEvaluationEvent {
    event_type: String,
    timestamp: String,
    state: Option<String>,
    from_state: Option<String>,
    to_state: Option<String>,
    mood: Option<f64>,
    previous_mood: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodEvaluationRequest {
    current_mood: f64,
    current_state: String,
    events: Vec<MoodEvaluationEvent>,
    settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodEvaluationResponse {
    delta: f64,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProactiveMessageRequest {
    current_mood: f64,
    current_state: String,
    trigger: String,
    settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProactiveMessageResponse {
    message: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
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

// ── SSE streaming ─────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: String,
}

#[derive(Debug, Default, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Clone, Serialize)]
struct ChatStreamToken {
    token: String,
    done: bool,
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
            chat_with_momo_stream,
            suggest_memory,
            evaluate_pet_mood,
            generate_proactive_message,
            set_click_through
        ])
        .setup(|app| {
            configure_pet_window(app)?;
            build_tray(app)?;
            // Global shortcut: Ctrl+Shift+M toggles the pet window visibility
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
            let handle = app.handle().clone();
            let _ = app
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, _event| {
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
            stream: false,
        });

    if !settings.api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", settings.api_key.trim()));
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
async fn chat_with_momo_stream(
    app: AppHandle,
    message: String,
    recent_messages: Vec<ChatMessage>,
    settings: Settings,
) -> Result<(), String> {
    validate_model_settings(&settings)?;

    let system_prompt = build_system_prompt(&settings);
    let mut messages = vec![OpenAiMessage {
        role: "system",
        content: &system_prompt,
    }];

    let mut normalized = recent_messages;
    if normalized.is_empty() {
        normalized.push(ChatMessage {
            role: "user".to_string(),
            content: message,
        });
    }

    for item in normalized.iter().rev().take(6).rev() {
        messages.push(OpenAiMessage {
            role: if item.role == "assistant" { "assistant" } else { "user" },
            content: &item.content,
        });
    }

    let endpoint = format!(
        "{}/chat/completions",
        settings.api_base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| err.to_string())?;

    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&ChatCompletionRequest {
            model: &settings.model,
            messages,
            temperature: 0.9,
            max_tokens: 180,
            stream: true,
        });

    if !settings.api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", settings.api_key.trim()));
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("模型接口请求失败（{}）：{}", status, body));
    }

    // Spawn background task to stream tokens via events
    tauri::async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buf = String::new();
        let mut done = false;

        use futures_util::StreamExt;
        while let Some(chunk_result) = stream.next().await {
            if done {
                break;
            }
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(_) => break,
            };
            buf.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete SSE lines
            while let Some(line_end) = buf.find('\n') {
                let line = buf[..line_end].trim().to_string();
                buf = buf[line_end + 1..].to_string();

                let data = line.strip_prefix("data: ").unwrap_or(&line);
                if data.is_empty() || data == "[DONE]" {
                    if data == "[DONE]" {
                        done = true;
                    }
                    continue;
                }

                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(token) = chunk.choices.first().map(|c| c.delta.content.clone()) {
                        if !token.is_empty() {
                            let _ = app.emit("chat-token", ChatStreamToken {
                                token,
                                done: false,
                            });
                        }
                    }
                }
            }
        }

        // Signal completion
        let _ = app.emit("chat-token", ChatStreamToken {
            token: String::new(),
            done: true,
        });
    });

    Ok(())
}

#[tauri::command]
async fn suggest_memory(
    message: String,
    assistant_reply: String,
    settings: Settings,
) -> Result<MemorySuggestionResponse, String> {
    if !settings.memory_enabled {
        return Ok(MemorySuggestionResponse { memory: None });
    }
    validate_model_settings(&settings)?;

    let existing_memory = settings.memory_notes.trim();
    let system_prompt = "你是桌宠猫的记忆筛选器。只判断这轮对话是否值得长期记住。\
只记稳定偏好、称呼、习惯、重要背景、明确承诺；不要记录临时情绪、普通寒暄、隐私敏感信息、密码、证件、地址、联系方式。\
输出严格 JSON：{\"memory\": string|null}。memory 必须是一句中文，少于 36 个字。";
    let user_prompt = format!(
        "已有长期记忆：{}\n用户：{}\n猫的回复：{}\n\n如果值得记住，提炼成一句长期记忆；如果不值得或已有重复记忆，memory=null。",
        if existing_memory.is_empty() {
            "无"
        } else {
            existing_memory
        },
        message,
        assistant_reply
    );

    let reply = request_chat_completion(&settings, system_prompt, user_prompt, 0.1, 80).await?;
    Ok(MemorySuggestionResponse {
        memory: parse_memory_suggestion(&reply),
    })
}

#[tauri::command]
async fn evaluate_pet_mood(
    request: MoodEvaluationRequest,
) -> Result<MoodEvaluationResponse, String> {
    let settings = request.settings;
    if !settings.ai_mood_calibration_enabled {
        return Err("AI 情绪校准未开启".to_string());
    }
    validate_model_settings(&settings)?;

    let event_summary = request
        .events
        .iter()
        .rev()
        .take(18)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|event| {
            format!(
                "- {} | state={} | from={} | to={} | mood={}",
                event.event_type,
                event.state.as_deref().unwrap_or("unknown"),
                event.from_state.as_deref().unwrap_or("-"),
                event.to_state.as_deref().unwrap_or("-"),
                event
                    .mood
                    .map(|value| value.round().to_string())
                    .unwrap_or_else(|| "-".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "当前心情：{:.0}/100\n当前状态：{}\n最近事件：\n{}\n\n请判断这些互动整体让 Momo 的心情应该小幅上调还是下调。",
        request.current_mood,
        request.current_state,
        if event_summary.is_empty() { "无" } else { &event_summary }
    );

    let system_prompt = "你是桌宠猫 Momo 的情绪评估器。你只根据最近互动做轻微校准，不负责行为决策。\
输出严格 JSON：{\"delta\": number, \"reason\": string}。\
delta 必须在 -6 到 6 之间，可以是小数；重复打扰、长时间拖拽、睡觉被叫醒通常为负；喂食、温和互动、聊天陪伴通常为正；reason 使用中文，12 个字以内。";

    let reply = request_chat_completion(&settings, system_prompt, user_prompt, 0.2, 80).await?;
    parse_mood_evaluation(&reply)
}

#[tauri::command]
async fn generate_proactive_message(
    request: ProactiveMessageRequest,
) -> Result<ProactiveMessageResponse, String> {
    let settings = request.settings;
    if !settings.proactive_bubble_enabled || !settings.ai_proactive_bubble_enabled {
        return Err("AI 主动话术未开启".to_string());
    }
    validate_model_settings(&settings)?;

    let pet_name = normalized_pet_name(&settings);
    let memory_prompt = build_memory_prompt(&settings);
    let system_prompt = format!(
        "你是桌宠猫猫 {}，会偶尔用气泡主动陪伴用户。\
只输出一句中文，不要解释，不要项目符号，不要超过 24 个字。\
语气像猫，轻柔自然；可以提醒休息、撒娇、说饿了、问今天有什么好玩的事。\
不要命令用户，不要频繁索取回应。{}",
        pet_name, memory_prompt
    );
    let user_prompt = format!(
        "当前心情：{:.0}/100\n当前状态：{}\n触发原因：{}\n请生成一句适合现在主动冒泡的话。",
        request.current_mood, request.current_state, request.trigger
    );
    let reply = request_chat_completion(&settings, &system_prompt, user_prompt, 0.85, 60).await?;
    let message = sanitize_proactive_message(&reply);
    if message.is_empty() {
        return Err("模型没有返回可用话术".to_string());
    }

    Ok(ProactiveMessageResponse { message })
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
    let show_item = MenuItem::with_id(app, "show", "显示 Momo", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏 Momo", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 MomoDesk", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &recall_item,
            &settings_item,
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
        "settings" => {
            if let Some(window) = app.get_webview_window("pet") {
                show_pet_window(&window, false);
                let _ = window.emit("tray-settings", ());
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
    let pet_name = normalized_pet_name(settings);
    let persona = match settings.persona_preset.as_str() {
        "clingy" => format!(
            "你是桌宠猫猫 {}，风格粘人、会撒娇、喜欢主动陪伴用户，但不要太吵。",
            pet_name
        ),
        "cool" => format!(
            "你是桌宠猫猫 {}，风格高冷、简洁、克制，偶尔流露温柔。",
            pet_name
        ),
        _ => format!(
            "你是桌宠猫猫 {}，风格傲娇、嘴硬心软、会关心用户但不直接承认。",
            pet_name
        ),
    };

    let mut prompt = persona;
    prompt.push_str(" 你的名字必须使用上面这个昵称；用户改名后，不要再自称旧名字。");
    prompt.push_str(" 你的回复要像桌面旁边轻声搭话的猫，不要写成长文。");
    prompt.push_str(" 默认使用中文，每次尽量控制在 1 到 3 句话，语气自然可爱，不要使用项目符号。");
    prompt.push_str(" 如果用户是在随口问一句，就简短回应；如果用户有情绪，就先安慰再回答。");
    prompt.push_str(&build_memory_prompt(settings));

    if !settings.custom_system_prompt.trim().is_empty() {
        prompt.push_str(" 额外要求：");
        prompt.push_str(settings.custom_system_prompt.trim());
    }

    prompt
}

fn normalized_pet_name(settings: &Settings) -> String {
    let name = settings.pet_name.trim();
    if name.is_empty() {
        default_pet_name()
    } else {
        name.chars().take(24).collect()
    }
}

fn build_memory_prompt(settings: &Settings) -> String {
    let memory = settings.memory_notes.trim();
    if !settings.memory_enabled || memory.is_empty() {
        return String::new();
    }

    let safe_memory: String = memory.chars().take(800).collect();
    format!(
        " 长期记忆：{} 请自然利用这些记忆，不要逐条复述，也不要把记忆当成刚刚发生的事。",
        safe_memory
    )
}

fn validate_model_settings(settings: &Settings) -> Result<(), String> {
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

    Ok(())
}

async fn request_chat_completion(
    settings: &Settings,
    system_prompt: &str,
    user_prompt: String,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let endpoint = format!(
        "{}/chat/completions",
        settings.api_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| err.to_string())?;
    let messages = vec![
        OpenAiMessage {
            role: "system",
            content: system_prompt,
        },
        OpenAiMessage {
            role: "user",
            content: &user_prompt,
        },
    ];
    let mut request = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&ChatCompletionRequest {
            model: &settings.model,
            messages,
            temperature,
            max_tokens,
            stream: false,
        });

    if !settings.api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", settings.api_key.trim()));
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("模型接口请求失败（{}）：{}", status, body));
    }

    let body: ChatCompletionResponse = response.json().await.map_err(|err| err.to_string())?;
    body.choices
        .first()
        .map(|choice| choice.message.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "模型没有返回可用内容".to_string())
}

fn parse_mood_evaluation(reply: &str) -> Result<MoodEvaluationResponse, String> {
    let trimmed = reply.trim();
    let json = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };
    let mut parsed: MoodEvaluationResponse =
        serde_json::from_str(json).map_err(|err| format!("情绪评估结果解析失败：{}", err))?;
    parsed.delta = parsed.delta.clamp(-6.0, 6.0);
    parsed.reason = parsed.reason.trim().chars().take(18).collect();
    if parsed.reason.is_empty() {
        parsed.reason = "已微调".to_string();
    }
    Ok(parsed)
}

fn parse_memory_suggestion(reply: &str) -> Option<String> {
    let trimmed = reply.trim();
    let json = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };

    let parsed: serde_json::Value = serde_json::from_str(json).ok()?;
    let memory = parsed.get("memory")?;
    if memory.is_null() {
        return None;
    }

    let value = memory.as_str()?.trim();
    if value.is_empty() {
        return None;
    }

    Some(
        value
            .replace('\n', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(48)
            .collect(),
    )
}

fn sanitize_proactive_message(reply: &str) -> String {
    reply
        .trim()
        .trim_matches('"')
        .trim_matches('“')
        .trim_matches('”')
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(28)
        .collect::<String>()
}
