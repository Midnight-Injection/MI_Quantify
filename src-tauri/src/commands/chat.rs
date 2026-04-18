use std::fs;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::storage;

const DB_FILE_NAME: &str = "mi_quantify.db";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: Option<i64>,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub code: Option<String>,
    pub stock_name: Option<String>,
    pub mode: Option<String>,
    pub meta: Option<String>,
    pub created_at: i64,
}

fn with_connection<T, F>(action: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let path = storage::app_data_file(DB_FILE_NAME)
        .map_err(|_| "无法定位用户目录或 Windows 用户目录变量".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let conn = Connection::open(path).map_err(|error| error.to_string())?;
    init_schema(&conn)?;
    action(&conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chat_conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            code TEXT,
            stock_name TEXT,
            mode TEXT,
            meta TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated
            ON chat_conversations(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
            ON chat_messages(conversation_id, created_at ASC);
        "#,
    )
    .map_err(|error| error.to_string())?;

    // migrate: add meta column if missing
    let has_meta: bool = conn
        .prepare("SELECT meta FROM chat_messages LIMIT 0")
        .is_ok();
    if !has_meta {
        conn.execute("ALTER TABLE chat_messages ADD COLUMN meta TEXT", [])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn chat_conversation_list() -> Result<Vec<ChatConversation>, String> {
    with_connection(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at
                 FROM chat_conversations
                 ORDER BY updated_at DESC
                 LIMIT 200",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ChatConversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn chat_conversation_create(
    id: String,
    title: String,
) -> Result<ChatConversation, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let conversation = ChatConversation {
        id,
        title,
        created_at: now,
        updated_at: now,
    };
    with_connection(|conn| {
        conn.execute(
            "INSERT INTO chat_conversations (id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                conversation.id,
                conversation.title,
                conversation.created_at,
                conversation.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(conversation)
    })
}

#[tauri::command]
pub async fn chat_conversation_update_title(id: String, title: String) -> Result<(), String> {
    with_connection(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE chat_conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, title, now],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn chat_conversation_delete(id: String) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "DELETE FROM chat_messages WHERE conversation_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
        conn.execute("DELETE FROM chat_conversations WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn chat_message_list(
    conversation_id: String,
    limit: Option<u32>,
) -> Result<Vec<ChatMessageRecord>, String> {
    let count = limit.unwrap_or(200).clamp(1, 1000);
    with_connection(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, code, stock_name, mode, meta, created_at
                 FROM chat_messages
                 WHERE conversation_id = ?1
                 ORDER BY created_at ASC
                 LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id, count], |row| {
                Ok(ChatMessageRecord {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    code: row.get(4)?,
                    stock_name: row.get(5)?,
                    mode: row.get(6)?,
                    meta: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn chat_message_add(message: ChatMessageRecord) -> Result<(), String> {
    with_connection(|conn| {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO chat_messages (conversation_id, role, content, code, stock_name, mode, meta, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                message.conversation_id,
                message.role,
                message.content,
                message.code,
                message.stock_name,
                message.mode,
                message.meta,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE chat_conversations SET updated_at = ?2 WHERE id = ?1",
            params![message.conversation_id, now],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn chat_message_clear(conversation_id: String) -> Result<(), String> {
    with_connection(|conn| {
        conn.execute(
            "DELETE FROM chat_messages WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })
}
