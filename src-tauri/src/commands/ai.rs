use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::time::sleep;

#[derive(Debug, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StreamChunk {
    Delta {
        request_id: String,
        content: String,
    },
    Reasoning {
        request_id: String,
        content: String,
    },
    Done {
        request_id: String,
        full_content: String,
    },
    Error {
        request_id: String,
        message: String,
    },
}

fn build_proxy_url(proxy: &ProxyConfig) -> Option<String> {
    if proxy.host.trim().is_empty() {
        return None;
    }
    let protocol = proxy.protocol.as_str();
    let host = proxy.host.trim();
    let port = proxy.port;
    if !proxy.username.is_empty() && !proxy.password.is_empty() {
        Some(format!(
            "{}://{}:{}@{}:{}",
            protocol, proxy.username, proxy.password, host, port
        ))
    } else {
        Some(format!("{}://{}:{}", protocol, host, port))
    }
}

fn build_client_with_proxy(proxy_url: Option<&str>, timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs));
    if let Some(url) = proxy_url {
        let proxy = reqwest::Proxy::all(url)
            .map_err(|e| format!("代理配置错误: {}", e))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("创建请求客户端失败: {}", e))
}

fn requires_disabled_thinking(api_url: &str) -> bool {
    api_url.contains("/api/coding/paas/")
}

fn extract_response_content(data: &serde_json::Value) -> String {
    data["choices"][0]["message"]["content"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            data["choices"][0]["message"]["reasoning_content"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ai_chat(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<AiMessage>,
    temperature: f32,
    max_tokens: u32,
    proxy: Option<ProxyConfig>,
) -> Result<String, String> {
    let proxy_url = proxy.as_ref().and_then(|p| {
        if p.enabled { build_proxy_url(p) } else { None }
    });
    let client = build_client_with_proxy(proxy_url.as_deref(), 60)?;
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    if requires_disabled_thinking(&api_url) {
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }

    for attempt in 0..3 {
        let resp = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if resp.status().is_success() {
            let data: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("解析响应失败: {}", e))?;
            let content = extract_response_content(&data);
            if content.trim().is_empty() {
                return Err("模型返回为空，请检查当前模型是否支持文本输出。".to_string());
            }
            return Ok(content);
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if (status.as_u16() == 429 || status.is_server_error()) && attempt < 2 {
            sleep(Duration::from_secs(attempt + 1)).await;
            continue;
        }
        return Err(format!("API 返回错误 {}: {}", status, text));
    }

    Err("模型请求失败".to_string())
}

#[tauri::command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    request_id: String,
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<AiMessage>,
    temperature: f32,
    max_tokens: u32,
    proxy: Option<ProxyConfig>,
) -> Result<String, String> {
    let proxy_url = proxy.as_ref().and_then(|p| {
        if p.enabled { build_proxy_url(p) } else { None }
    });
    let client = build_client_with_proxy(proxy_url.as_deref(), 120)?;

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": true,
    });
    if requires_disabled_thinking(&api_url) {
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }

    let mut full_content = String::new();
    let rid = request_id.clone();
    let event_name = "ai-stream-chunk";

    for attempt in 0..3u32 {
        let resp = match client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                if attempt < 2 {
                    sleep(Duration::from_secs((attempt + 1) as u64)).await;
                    continue;
                }
                let chunk = StreamChunk::Error {
                    request_id: rid.clone(),
                    message: format!("请求失败: {}", e),
                };
                let _ = app.emit(event_name, &chunk);
                return Err(format!("请求失败: {}", e));
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if (status.as_u16() == 429 || status.is_server_error()) && attempt < 2 {
                sleep(Duration::from_secs((attempt + 1) as u64)).await;
                continue;
            }
            let chunk = StreamChunk::Error {
                request_id: rid.clone(),
                message: format!("API 返回错误 {}: {}", status, text),
            };
            let _ = app.emit(event_name, &chunk);
            return Err(format!("API 返回错误 {}: {}", status, text));
        }

        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            let mut stream = resp.bytes_stream();
            use futures_util::StreamExt;

            let mut buffer = String::new();

            while let Some(chunk_result) = stream.next().await {
                let bytes = match chunk_result {
                    Ok(b) => b,
                    Err(e) => {
                        let err_chunk = StreamChunk::Error {
                            request_id: rid.clone(),
                            message: format!("流式读取失败: {}", e),
                        };
                        let _ = app.emit(event_name, &err_chunk);
                        break;
                    }
                };

                buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(newline_pos) = buffer.find('\n') {
                    let line = buffer[..newline_pos].trim().to_string();
                    buffer = buffer[newline_pos + 1..].to_string();

                    if line.is_empty() || line == "data: [DONE]" {
                        continue;
                    }

                    let data_str = if let Some(stripped) = line.strip_prefix("data: ") {
                        stripped
                    } else if line.starts_with('{') {
                        &line
                    } else {
                        continue;
                    };

                    let parsed: serde_json::Value = match serde_json::from_str(data_str) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let choices = match parsed.get("choices").and_then(|c| c.as_array()) {
                        Some(c) => c,
                        None => continue,
                    };

                    for choice in choices {
                        let delta = choice.get("delta");
                        if let Some(delta) = delta {
                            if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                if !content.is_empty() {
                                    full_content.push_str(content);
                                    let chunk = StreamChunk::Delta {
                                        request_id: rid.clone(),
                                        content: content.to_string(),
                                    };
                                    let _ = app.emit(event_name, &chunk);
                                }
                            }
                            if let Some(reasoning) =
                                delta.get("reasoning_content").and_then(|c| c.as_str())
                            {
                                if !reasoning.is_empty() {
                                    let chunk = StreamChunk::Reasoning {
                                        request_id: rid.clone(),
                                        content: reasoning.to_string(),
                                    };
                                    let _ = app.emit(event_name, &chunk);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            let data: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("解析响应失败: {}", e))?;
            let content = extract_response_content(&data);
            if content.trim().is_empty() {
                let chunk = StreamChunk::Error {
                    request_id: rid.clone(),
                    message: "模型返回为空".to_string(),
                };
                let _ = app.emit(event_name, &chunk);
                return Err("模型返回为空，请检查当前模型是否支持文本输出。".to_string());
            }
            full_content = content.clone();
            let chunk = StreamChunk::Delta {
                request_id: rid.clone(),
                content: content.clone(),
            };
            let _ = app.emit(event_name, &chunk);
        }

        let done_chunk = StreamChunk::Done {
            request_id: rid.clone(),
            full_content: full_content.clone(),
        };
        let _ = app.emit(event_name, &done_chunk);

        if full_content.trim().is_empty() {
            return Err("模型返回为空，请检查当前模型是否支持文本输出。".to_string());
        }
        return Ok(full_content);
    }

    let err_chunk = StreamChunk::Error {
        request_id: rid.clone(),
        message: "模型请求失败".to_string(),
    };
    let _ = app.emit(event_name, &err_chunk);
    Err("模型请求失败".to_string())
}

#[tauri::command]
pub async fn test_ai_connection(
    api_url: String,
    api_key: String,
    model: String,
    proxy: Option<ProxyConfig>,
) -> Result<String, String> {
    let messages = vec![AiMessage {
        role: "user".to_string(),
        content: "Hi, reply with OK".to_string(),
    }];
    let _ = ai_chat(api_url, api_key, model, messages, 0.1, 10, proxy).await?;
    Ok("连接成功".to_string())
}
