mod ai;
mod error;
mod export;
mod project;
mod secrets;
mod settings;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;

use ai::{ChatRequest, Provider};
use error::{Error, Result};
use project::{Node, Project};
use settings::Settings;

struct AppState {
    config_dir: PathBuf,
    secrets: secrets::Store,
    /// Held while a request is in flight; signalling it stops the stream at
    /// its next await, whether that is the initial send or a chunk read.
    cancel: Mutex<Option<Arc<Notify>>>,
}

impl AppState {
    fn settings(&self) -> Settings {
        settings::load(&self.config_dir)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedProject {
    path: String,
    project: Project,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptStats {
    words: usize,
    documents: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyStatus {
    configured: bool,
    backend: Option<secrets::Backend>,
}

fn as_root(path: &str) -> Result<PathBuf> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err(Error::Invalid(format!("{path} is not a folder.")));
    }
    Ok(root)
}

// ---------------------------------------------------------------------------
// Settings & keys
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    settings::save(&state.config_dir, &settings)
}

#[tauri::command]
fn key_status(state: State<'_, AppState>, provider: Provider) -> KeyStatus {
    let backend = state.secrets.backend_for(provider.key());
    KeyStatus {
        configured: backend.is_some(),
        backend,
    }
}

#[tauri::command]
fn set_api_key(state: State<'_, AppState>, provider: Provider, key: String) -> Result<KeyStatus> {
    let backend = state.secrets.set(provider.key(), key.trim())?;
    Ok(KeyStatus {
        configured: true,
        backend: Some(backend),
    })
}

#[tauri::command]
fn clear_api_key(state: State<'_, AppState>, provider: Provider) -> Result<()> {
    state.secrets.remove(provider.key())
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_project(
    state: State<'_, AppState>,
    parent: String,
    name: String,
) -> Result<OpenedProject> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("Give the project a name.".into()));
    }
    let (root, proj) = project::create(Path::new(&parent), name)?;
    let path = root.to_string_lossy().to_string();
    remember(&state, &path);
    Ok(OpenedProject { path, project: proj })
}

#[tauri::command]
fn open_project(state: State<'_, AppState>, path: String) -> Result<OpenedProject> {
    let root = as_root(&path)?;
    let proj = project::load(&root)?;
    remember(&state, &path);
    Ok(OpenedProject { path, project: proj })
}

fn remember(state: &State<'_, AppState>, path: &str) {
    let mut s = state.settings();
    s.note_opened(path);
    let _ = settings::save(&state.config_dir, &s);
}

#[tauri::command]
fn forget_project(state: State<'_, AppState>, path: String) -> Result<()> {
    let mut s = state.settings();
    s.recent.retain(|p| *p != path);
    settings::save(&state.config_dir, &s)
}

#[tauri::command]
fn save_project_meta(path: String, project: Project) -> Result<()> {
    project::save(&as_root(&path)?, &project)
}

#[tauri::command]
fn read_document(path: String, id: String) -> Result<String> {
    project::read_text(&project::content_path(&as_root(&path)?, &id)?)
}

#[tauri::command]
fn write_document(path: String, id: String, text: String) -> Result<()> {
    let target = project::content_path(&as_root(&path)?, &id)?;
    project::write_atomic(&target, text.as_bytes())
}

#[tauri::command]
fn read_outline(path: String, id: String) -> Result<String> {
    project::read_text(&project::outline_path(&as_root(&path)?, &id)?)
}

#[tauri::command]
fn write_outline(path: String, id: String, text: String) -> Result<()> {
    let target = project::outline_path(&as_root(&path)?, &id)?;
    project::write_atomic(&target, text.as_bytes())
}

/// Remove a document's files. The binder tree itself is edited in the frontend
/// and persisted by `save_project_meta`.
#[tauri::command]
fn delete_document(path: String, id: String) -> Result<()> {
    let root = as_root(&path)?;
    for target in [
        project::content_path(&root, &id)?,
        project::outline_path(&root, &id)?,
    ] {
        if target.exists() {
            std::fs::remove_file(target)?;
        }
    }
    Ok(())
}

/// Copy a research file into the project so it travels with the folder.
#[tauri::command]
fn import_reference(path: String, source: String) -> Result<String> {
    let root = as_root(&path)?;
    let src = PathBuf::from(&source);
    let stem = src
        .file_name()
        .map(|n| project::sanitize_file_name(&n.to_string_lossy()))
        .ok_or_else(|| Error::Invalid("That file has no name.".into()))?;

    // Don't clobber an earlier import with the same name.
    let mut name = stem.clone();
    let mut n = 1;
    while project::reference_path(&root, &name)?.exists() {
        let (base, ext) = match stem.rsplit_once('.') {
            Some((b, e)) => (b.to_string(), format!(".{e}")),
            None => (stem.clone(), String::new()),
        };
        name = format!("{base} ({n}){ext}");
        n += 1;
    }

    std::fs::copy(&src, project::reference_path(&root, &name)?)?;
    Ok(name)
}

#[tauri::command]
fn reference_full_path(path: String, name: String) -> Result<String> {
    Ok(project::reference_path(&as_root(&path)?, &name)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn manuscript_stats(path: String, project: Project) -> Result<ManuscriptStats> {
    let root = as_root(&path)?;
    let docs = project.manuscript_documents();
    let mut words = 0;
    for node in &docs {
        let text = project::read_text(&project::content_path(&root, &node.id)?)?;
        words += project::word_count(&text);
    }
    Ok(ManuscriptStats {
        words,
        documents: docs.len(),
    })
}

#[tauri::command]
fn export_manuscript(
    path: String,
    project: Project,
    format: String,
    destination: String,
) -> Result<String> {
    let root = as_root(&path)?;
    let compiled = export::compile(&root, &project, &format)?;
    let dest = PathBuf::from(&destination);
    project::write_atomic(&dest, compiled.as_bytes())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn suggested_export_name(project: Project, format: String) -> String {
    format!(
        "{}.{}",
        project::sanitize_file_name(&project.title),
        export::extension(&format)
    )
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

#[tauri::command]
async fn ai_send(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatRequest,
) -> Result<()> {
    let key = state.secrets.get(request.provider.key())?.ok_or_else(|| {
        Error::Invalid(format!(
            "No {} API key yet. Add one in Settings.",
            request.provider.label()
        ))
    })?;

    let cancel = Arc::new(Notify::new());
    {
        // Replace any in-flight request, and drop the guard before awaiting.
        let mut slot = state.cancel.lock().unwrap();
        if let Some(previous) = slot.replace(Arc::clone(&cancel)) {
            previous.notify_one();
        }
    }

    let outcome = ai::stream_chat(app, request, key, Arc::clone(&cancel)).await;

    // Only clear the slot if this request is still the current one.
    let mut slot = state.cancel.lock().unwrap();
    if slot.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
        *slot = None;
    }
    outcome
}

#[tauri::command]
fn ai_cancel(state: State<'_, AppState>) {
    if let Some(cancel) = state.cancel.lock().unwrap().take() {
        // notify_one stores a permit if the stream isn't waiting yet, so the
        // signal is never lost between chunk reads.
        cancel.notify_one();
    }
}

/// Word count for arbitrary text, so the editor and the backend always agree
/// on what counts as a word.
#[tauri::command]
fn count_words(text: String) -> usize {
    project::word_count(&text)
}

/// A fresh binder node, so ids are minted in one place.
#[tauri::command]
fn new_node(title: String, kind: project::NodeKind) -> Node {
    Node::new(title, kind)
}

// ---------------------------------------------------------------------------

/// WSLg's virtual GPU trips up WebKitGTK's DMA-BUF renderer: the window opens
/// blank or the process dies on launch. If we're under WSL and the user hasn't
/// chosen for themselves, fall back to software rendering. Real Linux boxes
/// and Windows are untouched.
#[cfg(target_os = "linux")]
fn workaround_wsl_rendering() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return; // the user has already decided
    }
    let is_wsl = std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .map(|r| r.to_ascii_lowercase().contains("microsoft"))
        .unwrap_or(false);
    if is_wsl {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    workaround_wsl_rendering();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            app.manage(AppState {
                secrets: secrets::Store::new(config_dir.clone()),
                config_dir,
                cancel: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            key_status,
            set_api_key,
            clear_api_key,
            create_project,
            open_project,
            forget_project,
            save_project_meta,
            read_document,
            write_document,
            read_outline,
            write_outline,
            delete_document,
            import_reference,
            reference_full_path,
            manuscript_stats,
            export_manuscript,
            suggested_export_name,
            count_words,
            new_node,
            ai_send,
            ai_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StoryKeep");
}
