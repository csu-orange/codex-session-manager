#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use dirs::home_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use walkdir::WalkDir;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSummary {
    provider: String,
    model: String,
    base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionOverview {
    total: usize,
    by_provider: BTreeMap<String, usize>,
    by_source: BTreeMap<String, usize>,
    by_location: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRecord {
    id: String,
    provider: String,
    provider_raw: String,
    timestamp: String,
    cwd: String,
    source: String,
    originator: String,
    cli_version: String,
    file_path: String,
    relative_path: String,
    location: String,
    size_bytes: u64,
    updated_at: String,
    event_count: usize,
    user_turns: usize,
    assistant_turns: usize,
    first_user: String,
    last_user: String,
    first_user_short: String,
    last_user_short: String,
    user_messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionListResponse {
    config: ConfigSummary,
    overview: SessionOverview,
    sessions: Vec<SessionRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMutationItem {
    id: String,
    provider: String,
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct TomlConfig {
    model_provider: Option<String>,
    model: Option<String>,
    model_providers: Option<BTreeMap<String, TomlProvider>>,
}

#[derive(Debug, Deserialize)]
struct TomlProvider {
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionMeta {
    id: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    originator: Option<String>,
    cli_version: Option<String>,
    source: Option<String>,
    model_provider: Option<String>,
}

#[derive(Debug)]
struct SessionRoots {
    codex_root: PathBuf,
    sessions_root: PathBuf,
    archived_root: PathBuf,
    config_path: PathBuf,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            archive_sessions,
            restore_sessions,
            delete_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn session_roots() -> Result<SessionRoots, AppError> {
    let codex_root = std::env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|dir| dir.join(".codex")))
        .ok_or_else(|| AppError::Message("Could not determine CODEX_HOME.".to_string()))?;

    Ok(SessionRoots {
        sessions_root: codex_root.join("sessions"),
        archived_root: codex_root.join("archived_sessions"),
        config_path: codex_root.join("config.toml"),
        codex_root,
    })
}

fn read_config_summary(config_path: &Path) -> Result<ConfigSummary, AppError> {
    let text = fs::read_to_string(config_path)?;
    let config: TomlConfig = toml::from_str(&text)?;

    let provider = config.model_provider.unwrap_or_default();
    let model = config.model.unwrap_or_default();
    let base_url = config
        .model_providers
        .as_ref()
        .and_then(|providers| providers.get(&provider))
        .and_then(|provider| provider.base_url.clone())
        .unwrap_or_default();

    Ok(ConfigSummary {
        provider,
        model,
        base_url,
    })
}

fn walk_jsonl_files(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }

    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .map(|entry| entry.into_path())
        .collect()
}

fn normalize_provider(provider: &str) -> String {
    let trimmed = provider.trim().to_lowercase();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed
    }
}

fn summarize_text(text: &str, limit: usize) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= limit {
        return normalized;
    }
    normalized.chars().take(limit.saturating_sub(1)).collect::<String>() + "…"
}

fn should_keep_user_text(text: &str) -> bool {
    !text.is_empty()
        && !text.starts_with("<environment_context>")
        && !text.starts_with("<turn_aborted>")
        && !text.starts_with("<skill>")
        && !text.starts_with("# AGENTS.md instructions")
}

fn extract_message_text(content: &[Value]) -> String {
    content
        .iter()
        .filter_map(|item| {
            let item_type = item.get("type")?.as_str()?;
            if item_type != "input_text" {
                return None;
            }
            item.get("text")?.as_str().map(|text| text.trim().to_string())
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn determine_location(path: &Path, roots: &SessionRoots) -> String {
    if path.strip_prefix(&roots.sessions_root).is_ok() {
        return "active".to_string();
    }
    if path.strip_prefix(&roots.archived_root).is_ok() {
        return "archived".to_string();
    }
    "unknown".to_string()
}

fn relative_path(path: &Path, root: &Path) -> Result<String, AppError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::Message(format!("Path escapes root: {}", path.display())))?;
    Ok(relative.to_string_lossy().replace('/', "\\"))
}

fn parse_session_file(path: &Path, roots: &SessionRoots) -> Result<SessionRecord, AppError> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut meta: Option<SessionMeta> = None;
    let mut first_user = String::new();
    let mut last_user = String::new();
    let mut user_turns = 0usize;
    let mut assistant_turns = 0usize;
    let mut event_count = 0usize;
    let mut user_messages = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let record: Value = match serde_json::from_str(&line) {
            Ok(record) => record,
            Err(_) => continue,
        };

        event_count += 1;
        let record_type = record.get("type").and_then(Value::as_str).unwrap_or_default();
        if record_type == "session_meta" {
            meta = serde_json::from_value(record.get("payload").cloned().unwrap_or(Value::Null)).ok();
            continue;
        }

        if record_type != "response_item" {
            continue;
        }

        let payload = match record.get("payload") {
            Some(payload) => payload,
            None => continue,
        };

        let role = payload.get("role").and_then(Value::as_str).unwrap_or_default();
        if role == "assistant" {
            assistant_turns += 1;
            continue;
        }
        if role != "user" {
            continue;
        }

        let content = payload
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let text = extract_message_text(&content);
        if !should_keep_user_text(&text) {
            continue;
        }

        user_turns += 1;
        if first_user.is_empty() {
            first_user = text.clone();
        }
        last_user = text.clone();
        user_messages.push(text);
    }

    let meta = meta.unwrap_or(SessionMeta {
        id: None,
        timestamp: None,
        cwd: None,
        originator: None,
        cli_version: None,
        source: None,
        model_provider: None,
    });

    let stats = fs::metadata(path)?;
    let updated_at: DateTime<Utc> = stats
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(Utc::now);
    let provider_raw = meta.model_provider.unwrap_or_else(|| "unknown".to_string());
    let location = determine_location(path, roots);

    Ok(SessionRecord {
        id: meta.id.unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_string()
        }),
        provider: normalize_provider(&provider_raw),
        provider_raw,
        timestamp: meta.timestamp.unwrap_or_else(|| updated_at.to_rfc3339()),
        cwd: meta.cwd.unwrap_or_default(),
        source: meta.source.unwrap_or_default(),
        originator: meta.originator.unwrap_or_default(),
        cli_version: meta.cli_version.unwrap_or_default(),
        file_path: path.display().to_string(),
        relative_path: relative_path(path, &roots.codex_root)?,
        location,
        size_bytes: stats.len(),
        updated_at: updated_at.to_rfc3339(),
        event_count,
        user_turns,
        assistant_turns,
        first_user_short: summarize_text(&first_user, 100),
        last_user_short: summarize_text(&last_user, 100),
        first_user,
        last_user,
        user_messages,
    })
}

fn load_sessions() -> Result<Vec<SessionRecord>, AppError> {
    let roots = session_roots()?;
    let mut files = walk_jsonl_files(&roots.sessions_root);
    files.extend(walk_jsonl_files(&roots.archived_root));

    let mut sessions = Vec::new();
    for file_path in files {
        sessions.push(parse_session_file(&file_path, &roots)?);
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

fn build_overview(sessions: &[SessionRecord]) -> SessionOverview {
    let mut by_provider = BTreeMap::new();
    let mut by_source = BTreeMap::new();
    let mut by_location = BTreeMap::new();

    for session in sessions {
        *by_provider.entry(session.provider.clone()).or_insert(0) += 1;
        *by_source
            .entry(if session.source.is_empty() {
                "unknown".to_string()
            } else {
                session.source.clone()
            })
            .or_insert(0) += 1;
        *by_location
            .entry(if session.location.is_empty() {
                "unknown".to_string()
            } else {
                session.location.clone()
            })
            .or_insert(0) += 1;
    }

    SessionOverview {
        total: sessions.len(),
        by_provider,
        by_source,
        by_location,
    }
}

fn list_response() -> Result<SessionListResponse, AppError> {
    let roots = session_roots()?;
    let sessions = load_sessions()?;
    let config = read_config_summary(&roots.config_path)?;
    let overview = build_overview(&sessions);
    Ok(SessionListResponse {
        config,
        overview,
        sessions,
    })
}

fn normalized_ids(ids: Vec<String>) -> Vec<String> {
    let mut unique = BTreeSet::new();
    for id in ids {
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            unique.insert(trimmed.to_string());
        }
    }
    unique.into_iter().collect()
}

fn ensure_dir(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path)?;
    Ok(())
}

fn archive_like(ids: Vec<String>, to_archived: bool) -> Result<Vec<SessionMutationItem>, AppError> {
    let roots = session_roots()?;
    let sessions = load_sessions()?;
    let by_id: BTreeMap<String, SessionRecord> =
        sessions.into_iter().map(|session| (session.id.clone(), session)).collect();
    let mut changed = Vec::new();

    for id in normalized_ids(ids) {
        let session = match by_id.get(&id) {
            Some(session) => session,
            None => continue,
        };

        let should_move = if to_archived {
            session.location == "active"
        } else {
            session.location == "archived"
        };
        if !should_move {
            continue;
        }

        let from = PathBuf::from(&session.file_path);
        let relative = if to_archived {
            from.strip_prefix(&roots.sessions_root)
                .map_err(|_| AppError::Message(format!("Invalid active session path: {}", from.display())))?
        } else {
            from.strip_prefix(&roots.archived_root)
                .map_err(|_| AppError::Message(format!("Invalid archived session path: {}", from.display())))?
        };

        let target_root = if to_archived {
            &roots.archived_root
        } else {
            &roots.sessions_root
        };

        let to = target_root.join(relative);
        ensure_dir(to.parent().ok_or_else(|| AppError::Message("Invalid target path".to_string()))?)?;
        fs::rename(&from, &to)?;
        changed.push(SessionMutationItem {
            id: session.id.clone(),
            provider: session.provider.clone(),
            from: from.display().to_string(),
            to: to.display().to_string(),
        });
    }

    Ok(changed)
}

fn delete_by_ids(ids: Vec<String>) -> Result<Vec<SessionMutationItem>, AppError> {
    let sessions = load_sessions()?;
    let by_id: BTreeMap<String, SessionRecord> =
        sessions.into_iter().map(|session| (session.id.clone(), session)).collect();
    let mut deleted = Vec::new();

    for id in normalized_ids(ids) {
        let session = match by_id.get(&id) {
            Some(session) => session,
            None => continue,
        };

        let path = PathBuf::from(&session.file_path);
        fs::remove_file(&path)?;
        deleted.push(SessionMutationItem {
            id: session.id.clone(),
            provider: session.provider.clone(),
            from: path.display().to_string(),
            to: String::new(),
        });
    }

    Ok(deleted)
}

#[tauri::command]
fn get_sessions() -> Result<SessionListResponse, AppError> {
    list_response()
}

#[tauri::command]
fn archive_sessions(ids: Vec<String>) -> Result<serde_json::Value, AppError> {
    let archived = archive_like(ids, true)?;
    Ok(serde_json::json!({ "archived": archived }))
}

#[tauri::command]
fn restore_sessions(ids: Vec<String>) -> Result<serde_json::Value, AppError> {
    let restored = archive_like(ids, false)?;
    Ok(serde_json::json!({ "restored": restored }))
}

#[tauri::command]
fn delete_sessions(ids: Vec<String>) -> Result<serde_json::Value, AppError> {
    let deleted = delete_by_ids(ids)?;
    Ok(serde_json::json!({ "deleted": deleted }))
}
