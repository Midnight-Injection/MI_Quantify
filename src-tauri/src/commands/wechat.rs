use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use qrcode::{render::svg, QrCode};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use thiserror::Error;
use tokio::{sync::Mutex, time::sleep};
use uuid::Uuid;

use crate::storage;

const DEFAULT_WECHAT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const LOGIN_FILE_NAME: &str = "wechat_accounts.json";
const CONTEXT_FILE_NAME: &str = "wechat_contexts.json";
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatLoginQrCode {
    pub qrcode: String,
    pub qrcode_img: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatLoginStatus {
    pub status: String,
    pub bot_token: Option<String>,
    pub base_url: Option<String>,
    pub account_id: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatChannelStatus {
    pub channel_id: String,
    pub logged_in: bool,
    pub listening: bool,
    pub account_id: Option<String>,
    pub user_id: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMessage {
    pub id: String,
    pub from_user_id: String,
    pub create_time_ms: i64,
    pub text: Option<String>,
    pub context_token: Option<String>,
    pub is_outgoing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WechatMessageEvent {
    channel_id: String,
    message: WechatMessage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WechatStatusEvent {
    channel_id: String,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WechatErrorEvent {
    channel_id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredWechatAccount {
    channel_id: String,
    account_id: String,
    user_id: String,
    base_url: String,
    bot_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredPeerContext {
    peer_id: String,
    context_token: String,
    updated_at: i64,
}

#[derive(Clone)]
struct UpdateMessage {
    from_user_id: String,
    create_time_ms: i64,
    text: Option<String>,
    context_token: Option<String>,
    message_id: Option<i64>,
}

#[derive(Clone)]
struct GetUpdatesResponse {
    get_updates_buf: Option<String>,
    messages: Vec<UpdateMessage>,
}

#[derive(Clone)]
struct WechatClient {
    client: Client,
    base_url: String,
}

#[derive(Clone)]
struct WechatMonitor {
    channel_id: String,
    client: WechatClient,
    account: StoredWechatAccount,
    running: Arc<Mutex<bool>>,
}

pub struct WechatRuntimeState {
    monitors: Mutex<HashMap<String, WechatMonitor>>,
}

#[derive(Debug, Error)]
enum WechatApiError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("Session expired")]
    SessionExpired,
    #[error("Invalid token")]
    InvalidToken,
}

impl WechatClient {
    fn with_base_url(base_url: String) -> Result<Self, WechatApiError> {
        let client = Client::builder().timeout(Duration::from_secs(40)).build()?;
        Ok(Self { client, base_url })
    }

    async fn get_bot_qrcode(&self) -> Result<WechatLoginQrCode, WechatApiError> {
        let url = format!("{}/ilink/bot/get_bot_qrcode?bot_type=3", self.base_url);
        let response = self.client.get(url).send().await?;
        let body = response.text().await?;
        let json: serde_json::Value = serde_json::from_str(&body)?;
        let data = json.get("data").unwrap_or(&json);
        Self::ensure_success(&json)?;

        let qrcode = data
            .get("qrcode")
            .and_then(|value| value.as_str())
            .ok_or_else(|| WechatApiError::Api("missing qrcode".to_string()))?
            .to_string();
        let qrcode_content = data
            .get("qrcode_img_content")
            .and_then(|value| value.as_str())
            .ok_or_else(|| WechatApiError::Api("missing qrcode_img_content".to_string()))?;

        let code =
            QrCode::new(qrcode_content).map_err(|error| WechatApiError::Api(error.to_string()))?;
        let svg_string = code
            .render::<svg::Color>()
            .min_dimensions(256, 256)
            .dark_color(svg::Color("#111111"))
            .light_color(svg::Color("#FFFFFF"))
            .build();

        Ok(WechatLoginQrCode {
            qrcode,
            qrcode_img: format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(svg_string)
            ),
        })
    }

    async fn get_qrcode_status(&self, qrcode: &str) -> Result<WechatLoginStatus, WechatApiError> {
        let url = format!(
            "{}/ilink/bot/get_qrcode_status?qrcode={}",
            self.base_url, qrcode
        );
        let response = self.client.get(url).send().await?;
        let body = response.text().await?;
        let json: serde_json::Value = serde_json::from_str(&body)?;
        let data = json.get("data").unwrap_or(&json);
        Self::ensure_success(&json)?;

        let status = match data
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("waiting")
        {
            "waiting" | "wait" => "waiting",
            "scanned" | "scaned" => "scanned",
            "confirmed" => "confirmed",
            "cancelled" => "cancelled",
            "expired" => "expired",
            other => other,
        };

        Ok(WechatLoginStatus {
            status: status.to_string(),
            bot_token: data
                .get("bot_token")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            base_url: data
                .get("baseurl")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            account_id: data
                .get("ilink_bot_id")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            user_id: data
                .get("ilink_user_id")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        })
    }

    async fn get_updates(
        &self,
        bot_token: &str,
        get_updates_buf: Option<&str>,
    ) -> Result<GetUpdatesResponse, WechatApiError> {
        let url = format!("{}/ilink/bot/getupdates", self.base_url);
        let body = json!({
            "get_updates_buf": get_updates_buf.unwrap_or(""),
            "base_info": {
                "channel_version": "1.0.2"
            }
        });

        let response = self
            .authorized_request(self.client.post(url), bot_token)
            .json(&body)
            .timeout(Duration::from_secs(35))
            .send()
            .await?;
        let body = response.text().await?;
        let json: serde_json::Value = serde_json::from_str(&body)?;
        Self::ensure_success(&json)?;

        let messages = json
            .get("msgs")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(Self::parse_update_message)
                    .collect()
            })
            .unwrap_or_default();

        Ok(GetUpdatesResponse {
            get_updates_buf: json
                .get("get_updates_buf")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            messages,
        })
    }

    async fn send_text_message(
        &self,
        bot_token: &str,
        to_user_id: &str,
        context_token: &str,
        text: &str,
    ) -> Result<WechatMessage, WechatApiError> {
        let url = format!("{}/ilink/bot/sendmessage", self.base_url);
        let client_id = Uuid::new_v4().to_string();
        let now = now_millis();
        let body = json!({
            "msg": {
                "to_user_id": to_user_id,
                "client_id": client_id,
                "message_type": 2,
                "message_state": 2,
                "context_token": context_token,
                "item_list": [
                    {
                        "type": 1,
                        "text_item": {
                            "text": text
                        }
                    }
                ]
            }
        });

        let response = self
            .authorized_request(self.client.post(url), bot_token)
            .json(&body)
            .send()
            .await?;
        let body = response.text().await?;
        let json: serde_json::Value = serde_json::from_str(&body)?;
        Self::ensure_success(&json)?;

        Ok(WechatMessage {
            id: client_id,
            from_user_id: to_user_id.to_string(),
            create_time_ms: now,
            text: Some(text.to_string()),
            context_token: Some(context_token.to_string()),
            is_outgoing: true,
        })
    }

    fn authorized_request(&self, request: RequestBuilder, bot_token: &str) -> RequestBuilder {
        request
            .header("Content-Type", "application/json")
            .header("AuthorizationType", "ilink_bot_token")
            .header("Authorization", format!("Bearer {}", bot_token))
            .header(
                "X-WECHAT-UIN",
                base64::engine::general_purpose::STANDARD.encode(rand_u32().to_be_bytes()),
            )
    }

    fn ensure_success(json: &serde_json::Value) -> Result<(), WechatApiError> {
        let ret = json
            .get("ret")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        if ret == 0 {
            return Ok(());
        }
        match ret {
            -14 => Err(WechatApiError::SessionExpired),
            -1 | -2 => Err(WechatApiError::InvalidToken),
            _ => Err(WechatApiError::Api(
                json.get("errMsg")
                    .and_then(|value| value.as_str())
                    .unwrap_or("request failed")
                    .to_string(),
            )),
        }
    }

    fn parse_update_message(value: &serde_json::Value) -> Option<UpdateMessage> {
        let text = value
            .get("item_list")
            .and_then(|items| items.as_array())
            .and_then(|items| items.first())
            .and_then(|item| item.get("text_item"))
            .and_then(|item| item.get("text"))
            .and_then(|value| value.as_str())
            .map(str::to_string);

        let context_token = value
            .get("context_token")
            .and_then(|value| value.as_str())
            .map(str::to_string);

        let from_user_id = value
            .get("from_user_id")
            .and_then(|value| value.as_str())?
            .to_string();
        let create_time_ms = value
            .get("create_time_ms")
            .and_then(|value| value.as_i64())
            .unwrap_or_else(now_millis);

        Some(UpdateMessage {
            from_user_id,
            create_time_ms,
            text,
            context_token,
            message_id: value.get("message_id").and_then(|value| value.as_i64()),
        })
    }
}

impl WechatMonitor {
    fn new(channel_id: String, client: WechatClient, account: StoredWechatAccount) -> Self {
        Self {
            channel_id,
            client,
            account,
            running: Arc::new(Mutex::new(false)),
        }
    }

    async fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut running = self.running.lock().await;
        if *running {
            return Err("当前渠道已在监听".to_string());
        }
        *running = true;
        drop(running);
        emit_status(&app, &self.channel_id, "listening");
        self.run_loop(app).await
    }

    async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }

    async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    async fn run_loop(&self, app: AppHandle) -> Result<(), String> {
        let mut consecutive_failures = 0_u32;

        loop {
            if !self.is_running().await {
                break;
            }

            let sync_buf = load_sync_cursor(&app, &self.channel_id)?;
            match self
                .client
                .get_updates(&self.account.bot_token, sync_buf.as_deref())
                .await
            {
                Ok(response) => {
                    consecutive_failures = 0;
                    if let Some(cursor) = response.get_updates_buf {
                        save_sync_cursor(&app, &self.channel_id, Some(cursor))?;
                    }

                    for update in response.messages {
                        if let Some(context_token) = update.context_token.clone() {
                            save_peer_context(
                                &app,
                                &self.channel_id,
                                &update.from_user_id,
                                &context_token,
                            )?;
                        }
                        let message = WechatMessage {
                            id: update
                                .message_id
                                .map(|value| value.to_string())
                                .unwrap_or_else(|| {
                                    format!("{}_{}", update.from_user_id, update.create_time_ms)
                                }),
                            from_user_id: update.from_user_id,
                            create_time_ms: update.create_time_ms,
                            text: update.text,
                            context_token: update.context_token,
                            is_outgoing: false,
                        };
                        let _ = app.emit(
                            "wechat:message",
                            WechatMessageEvent {
                                channel_id: self.channel_id.clone(),
                                message,
                            },
                        );
                    }
                }
                Err(WechatApiError::SessionExpired | WechatApiError::InvalidToken) => {
                    let _ = delete_account(&app, &self.channel_id);
                    let _ = delete_sync_cursor(&app, &self.channel_id);
                    let _ = clear_peer_contexts(&app, &self.channel_id);
                    emit_status(&app, &self.channel_id, "error");
                    emit_error(&app, &self.channel_id, "会话已过期，请重新扫码登录");
                    break;
                }
                Err(error) => {
                    consecutive_failures += 1;
                    emit_error(&app, &self.channel_id, &error.to_string());
                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                        consecutive_failures = 0;
                        sleep(Duration::from_secs(30)).await;
                    } else {
                        sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }

        let mut running = self.running.lock().await;
        *running = false;
        drop(running);
        emit_status(&app, &self.channel_id, "idle");
        Ok(())
    }
}

#[tauri::command]
pub async fn wechat_start_login(
    _channel_id: String,
    base_url: Option<String>,
) -> Result<WechatLoginQrCode, String> {
    let client = WechatClient::with_base_url(resolve_base_url(base_url))
        .map_err(|error| error.to_string())?;
    let qr = client
        .get_bot_qrcode()
        .await
        .map_err(|error| error.to_string())?;
    Ok(WechatLoginQrCode {
        qrcode: qr.qrcode,
        qrcode_img: qr.qrcode_img,
    })
}

#[tauri::command]
pub async fn wechat_get_login_status(
    app: AppHandle,
    channel_id: String,
    qrcode: String,
    base_url: Option<String>,
) -> Result<WechatLoginStatus, String> {
    let resolved_base_url = resolve_base_url(base_url);
    let client = WechatClient::with_base_url(resolved_base_url.clone())
        .map_err(|error| error.to_string())?;
    let status = client
        .get_qrcode_status(&qrcode)
        .await
        .map_err(|error| error.to_string())?;
    if status.status == "confirmed" {
        let account = StoredWechatAccount {
            channel_id: channel_id.clone(),
            account_id: status.account_id.clone().unwrap_or_default(),
            user_id: status.user_id.clone().unwrap_or_default(),
            base_url: status.base_url.clone().unwrap_or(resolved_base_url),
            bot_token: status
                .bot_token
                .clone()
                .ok_or_else(|| "登录成功但未返回 bot_token".to_string())?,
        };
        save_account(&app, account)?;
        emit_status(&app, &channel_id, "ready");
    }
    Ok(status)
}

#[tauri::command]
pub async fn wechat_get_channel_status(
    app: AppHandle,
    state: State<'_, WechatRuntimeState>,
    channel_id: String,
) -> Result<WechatChannelStatus, String> {
    let account = load_account(&app, &channel_id)?;
    let listening = {
        let monitors = state.monitors.lock().await;
        if let Some(monitor) = monitors.get(&channel_id) {
            monitor.is_running().await
        } else {
            false
        }
    };

    let mut logged_in = account.is_some();
    if let Some(ref acc) = account {
        if let Ok(client) = WechatClient::with_base_url(acc.base_url.clone()) {
            match client.get_updates(&acc.bot_token, None).await {
                Ok(_) => {}
                Err(WechatApiError::SessionExpired | WechatApiError::InvalidToken) => {
                    let _ = delete_account(&app, &channel_id);
                    let _ = delete_sync_cursor(&app, &channel_id);
                    logged_in = false;
                }
                Err(_) => {}
            }
        }
    }

    let fresh_account = if !logged_in { None } else { account };

    Ok(WechatChannelStatus {
        channel_id,
        logged_in,
        listening,
        account_id: fresh_account.as_ref().map(|item| item.account_id.clone()),
        user_id: fresh_account.as_ref().map(|item| item.user_id.clone()),
        base_url: fresh_account.as_ref().map(|item| item.base_url.clone()),
    })
}

#[tauri::command]
pub async fn wechat_start_listener(
    app: AppHandle,
    state: State<'_, WechatRuntimeState>,
    channel_id: String,
) -> Result<(), String> {
    let account =
        load_account(&app, &channel_id)?.ok_or_else(|| "当前渠道还没有完成扫码登录".to_string())?;
    let client =
        WechatClient::with_base_url(account.base_url.clone()).map_err(|error| error.to_string())?;
    let monitor = WechatMonitor::new(channel_id.clone(), client, account);

    {
        let mut monitors = state.monitors.lock().await;
        if let Some(current) = monitors.get(&channel_id) {
            if current.is_running().await {
                return Ok(());
            }
        }
        monitors.insert(channel_id.clone(), monitor.clone());
    }

    let app_handle = app.clone();
    tokio::spawn(async move {
        if let Err(error) = monitor.start(app_handle.clone()).await {
            emit_status(&app_handle, &channel_id, "error");
            emit_error(&app_handle, &channel_id, &error);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn wechat_stop_listener(
    app: AppHandle,
    state: State<'_, WechatRuntimeState>,
    channel_id: String,
) -> Result<(), String> {
    let monitor = {
        let mut monitors = state.monitors.lock().await;
        monitors.remove(&channel_id)
    };

    if let Some(monitor) = monitor {
        monitor.stop().await;
    }
    emit_status(&app, &channel_id, "idle");
    Ok(())
}

#[tauri::command]
pub async fn wechat_logout_channel(
    app: AppHandle,
    state: State<'_, WechatRuntimeState>,
    channel_id: String,
) -> Result<(), String> {
    wechat_stop_listener(app.clone(), state, channel_id.clone()).await?;
    delete_account(&app, &channel_id)?;
    delete_sync_cursor(&app, &channel_id)?;
    clear_peer_contexts(&app, &channel_id)?;
    Ok(())
}

#[tauri::command]
pub async fn wechat_send_message(
    app: AppHandle,
    channel_id: String,
    to_user_id: String,
    text: String,
    context_token: Option<String>,
) -> Result<(), String> {
    let account = load_account(&app, &channel_id)?.ok_or_else(|| "当前渠道未登录".to_string())?;
    let client =
        WechatClient::with_base_url(account.base_url.clone()).map_err(|error| error.to_string())?;
    let target_user_id = if to_user_id.trim().is_empty() {
        load_latest_peer_context(&app, &channel_id)?
            .map(|item| item.peer_id)
            .unwrap_or_else(|| account.user_id.clone())
    } else {
        to_user_id
    };
    let token = context_token
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            load_peer_context(&app, &channel_id, &target_user_id)
                .ok()
                .flatten()
                .map(|item| item.context_token)
        })
        .ok_or_else(|| "缺少上下文 token，请先让该微信会话发来一条消息".to_string())?;

    let message = client
        .send_text_message(&account.bot_token, &target_user_id, &token, &text)
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit(
        "wechat:message",
        WechatMessageEvent {
            channel_id,
            message,
        },
    );
    Ok(())
}

pub fn init_wechat_runtime_state() -> WechatRuntimeState {
    WechatRuntimeState {
        monitors: Mutex::new(HashMap::new()),
    }
}

fn resolve_base_url(base_url: Option<String>) -> String {
    base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WECHAT_BASE_URL.to_string())
}

fn emit_status(app: &AppHandle, channel_id: &str, status: &str) {
    let _ = app.emit(
        "wechat:status",
        WechatStatusEvent {
            channel_id: channel_id.to_string(),
            status: status.to_string(),
        },
    );
}

fn emit_error(app: &AppHandle, channel_id: &str, error: &str) {
    let _ = app.emit(
        "wechat:error",
        WechatErrorEvent {
            channel_id: channel_id.to_string(),
            error: error.to_string(),
        },
    );
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let target = storage::app_data_file(name)
        .map_err(|_| "无法读取用户目录或 Windows 用户目录变量".to_string())?;
    let mut candidates = Vec::new();
    if let Some(legacy) = storage::legacy_file(name) {
        candidates.push(legacy);
    }
    candidates.extend(storage::app_support_candidates(app, name));
    storage::migrate_file_if_missing(&target, &candidates)
        .map_err(|error| format!("迁移微信数据失败: {error}"))?;

    Ok(target)
}

fn read_json_map<T>(path: &PathBuf) -> Result<HashMap<String, T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(path).map_err(|error| format!("读取文件失败: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("解析文件失败: {error}"))
}

fn write_json_map<T>(path: &PathBuf, value: &HashMap<String, T>) -> Result<(), String>
where
    T: Serialize,
{
    let raw =
        serde_json::to_string_pretty(value).map_err(|error| format!("序列化文件失败: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("写入文件失败: {error}"))
}

fn load_account(app: &AppHandle, channel_id: &str) -> Result<Option<StoredWechatAccount>, String> {
    let file = data_file(app, LOGIN_FILE_NAME)?;
    let map: HashMap<String, StoredWechatAccount> = read_json_map(&file)?;
    Ok(map.get(channel_id).cloned())
}

fn save_account(app: &AppHandle, account: StoredWechatAccount) -> Result<(), String> {
    let file = data_file(app, LOGIN_FILE_NAME)?;
    let mut map: HashMap<String, StoredWechatAccount> = read_json_map(&file)?;
    map.insert(account.channel_id.clone(), account);
    write_json_map(&file, &map)
}

fn delete_account(app: &AppHandle, channel_id: &str) -> Result<(), String> {
    let file = data_file(app, LOGIN_FILE_NAME)?;
    let mut map: HashMap<String, StoredWechatAccount> = read_json_map(&file)?;
    map.remove(channel_id);
    write_json_map(&file, &map)
}

fn load_sync_cursor(app: &AppHandle, channel_id: &str) -> Result<Option<String>, String> {
    let file = data_file(app, &format!("wechat-sync-{channel_id}.json"))?;
    if !file.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(file).map_err(|error| format!("读取游标失败: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("解析游标失败: {error}"))
}

fn save_sync_cursor(
    app: &AppHandle,
    channel_id: &str,
    value: Option<String>,
) -> Result<(), String> {
    let file = data_file(app, &format!("wechat-sync-{channel_id}.json"))?;
    let raw =
        serde_json::to_string_pretty(&value).map_err(|error| format!("写入游标失败: {error}"))?;
    fs::write(file, raw).map_err(|error| format!("保存游标失败: {error}"))
}

fn delete_sync_cursor(app: &AppHandle, channel_id: &str) -> Result<(), String> {
    let file = data_file(app, &format!("wechat-sync-{channel_id}.json"))?;
    if file.exists() {
        fs::remove_file(file).map_err(|error| format!("删除游标失败: {error}"))?;
    }
    Ok(())
}

fn load_all_peer_contexts(
    app: &AppHandle,
) -> Result<HashMap<String, HashMap<String, StoredPeerContext>>, String> {
    let file = data_file(app, CONTEXT_FILE_NAME)?;
    read_json_map(&file)
}

fn save_all_peer_contexts(
    app: &AppHandle,
    value: &HashMap<String, HashMap<String, StoredPeerContext>>,
) -> Result<(), String> {
    let file = data_file(app, CONTEXT_FILE_NAME)?;
    write_json_map(&file, value)
}

fn save_peer_context(
    app: &AppHandle,
    channel_id: &str,
    peer_id: &str,
    context_token: &str,
) -> Result<(), String> {
    let mut all = load_all_peer_contexts(app)?;
    let channel_contexts = all.entry(channel_id.to_string()).or_default();
    channel_contexts.insert(
        peer_id.to_string(),
        StoredPeerContext {
            peer_id: peer_id.to_string(),
            context_token: context_token.to_string(),
            updated_at: now_millis(),
        },
    );
    save_all_peer_contexts(app, &all)
}

fn load_peer_context(
    app: &AppHandle,
    channel_id: &str,
    peer_id: &str,
) -> Result<Option<StoredPeerContext>, String> {
    let all = load_all_peer_contexts(app)?;
    Ok(all
        .get(channel_id)
        .and_then(|items| items.get(peer_id))
        .cloned())
}

fn load_latest_peer_context(
    app: &AppHandle,
    channel_id: &str,
) -> Result<Option<StoredPeerContext>, String> {
    let all = load_all_peer_contexts(app)?;
    Ok(all
        .get(channel_id)
        .and_then(|items| items.values().max_by_key(|item| item.updated_at).cloned()))
}

fn clear_peer_contexts(app: &AppHandle, channel_id: &str) -> Result<(), String> {
    let mut all = load_all_peer_contexts(app)?;
    all.remove(channel_id);
    save_all_peer_contexts(app, &all)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn rand_u32() -> u32 {
    (now_millis() as u64 % u32::MAX as u64) as u32
}
