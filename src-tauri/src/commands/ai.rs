use std::{env, fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiConfig {
    pub provider_id: String,
    pub api_key: String,
    pub api_url: String,
    pub model: String,
    pub search_api_key: Option<String>,
}

fn read_json_file(path: PathBuf) -> Option<serde_json::Value> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub async fn ai_chat(
    api_url: String,
    api_key: String,
    model: String,
    messages: Vec<AiMessage>,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });

    let resp = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 {}: {}", status, text));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(content)
}

#[tauri::command]
pub async fn test_ai_connection(
    api_url: String,
    api_key: String,
    model: String,
) -> Result<String, String> {
    let messages = vec![AiMessage {
        role: "user".to_string(),
        content: "Hi, reply with OK".to_string(),
    }];
    let _ = ai_chat(api_url, api_key, model, messages, 0.1, 10).await?;
    Ok("连接成功".to_string())
}

#[tauri::command]
pub fn load_local_ai_config() -> Result<Option<LocalAiConfig>, String> {
    let home = env::var("HOME").map_err(|e| format!("读取 HOME 失败: {}", e))?;

    let opencode_config = read_json_file(PathBuf::from(format!("{}/.config/opencode/opencode.json", home)));
    let opencode_auth = read_json_file(PathBuf::from(format!("{}/.local/share/opencode/auth.json", home)));
    let opencode_model = read_json_file(PathBuf::from(format!("{}/.local/state/opencode/model.json", home)));

    let provider_id = opencode_model
        .as_ref()
        .and_then(|value| value.get("recent"))
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|item| item.get("providerID"))
        .and_then(|value| value.as_str())
        .unwrap_or("zhipuai-coding-plan")
        .to_string();

    let model = opencode_model
        .as_ref()
        .and_then(|value| value.get("recent"))
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|item| item.get("modelID"))
        .and_then(|value| value.as_str())
        .unwrap_or("glm-5.1")
        .to_string();

    let api_key = opencode_auth
        .as_ref()
        .and_then(|value| value.get(&provider_id))
        .and_then(|value| value.get("key"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
            opencode_config
                .as_ref()
                .and_then(|value| value.get("mcp"))
                .and_then(|value| value.get("zai-mcp-server"))
                .and_then(|value| value.get("environment"))
                .and_then(|value| value.get("Z_AI_API_KEY"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        });

    let search_api_key = opencode_config
        .as_ref()
        .and_then(|value| value.get("mcp"))
        .and_then(|value| value.get("web-search-prime"))
        .and_then(|value| value.get("headers"))
        .and_then(|value| value.get("Authorization"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim_start_matches("Bearer ").to_string());

    let Some(api_key) = api_key else {
        return Ok(None);
    };

    Ok(Some(LocalAiConfig {
        provider_id,
        api_key: api_key.clone(),
        api_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string(),
        model,
        search_api_key: search_api_key.or_else(|| Some(api_key.clone())),
    }))
}
