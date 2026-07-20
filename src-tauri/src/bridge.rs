//! State + packs bridge — the Rust twin of app/src/bridge/plugin.ts.
//!
//! Semantics are ported 1:1 from the vite middleware so a save written by the web
//! dev bridge and one written here are interchangeable:
//!   - state names validated against [A-Za-z0-9._-]+ with no `..`
//!   - state writes are atomic (tmp file + rename), mkdir -p, touch only the target
//!   - missing/unparseable state reads → null, never an error
//!   - packs listed from <packs>/<dir>/pack.json; bad JSON skipped; id = meta.id or dir
//!   - pack assets resolved strictly inside <pack>/assets/ (no `..`, no absolute paths)
//!
//! Directory resolution (documented in docs/tauri.md):
//!   STATE_DIR env  → that dir (how the author points the app at the repo's state/)
//!   otherwise      → <app-data>/state (macOS: ~/Library/Application Support/<identifier>/state)
//!   PACKS_DIR env  → that dir
//!   otherwise, dev → <repo>/packs (baked from CARGO_MANIFEST_DIR; `tauri dev` only)
//!   otherwise      → <app-data>/packs

use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

fn env_dir(var: &str) -> Option<PathBuf> {
    match env::var(var) {
        Ok(v) if !v.trim().is_empty() => Some(PathBuf::from(v)),
        _ => None,
    }
}

fn app_data(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn state_dir(app: &AppHandle) -> PathBuf {
    env_dir("STATE_DIR").unwrap_or_else(|| app_data(app).join("state"))
}

pub fn packs_dir(app: &AppHandle) -> PathBuf {
    if let Some(dir) = env_dir("PACKS_DIR") {
        return dir;
    }
    // Dev builds run from the repo (`tauri dev`): use the repo's packs/ so installed
    // content is visible with zero configuration. Release builds never take this path.
    #[cfg(debug_assertions)]
    {
        let repo_packs = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packs");
        if repo_packs.is_dir() {
            return repo_packs;
        }
    }
    app_data(app).join("packs")
}

fn is_valid_state_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

#[tauri::command]
pub fn state_read(app: AppHandle, name: String) -> Result<Option<Value>, String> {
    if !is_valid_state_name(&name) {
        return Err(format!("invalid state name: {name}"));
    }
    match fs::read_to_string(state_dir(&app).join(&name)) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(_) => Ok(None), // missing file
    }
}

#[tauri::command]
pub fn state_write(app: AppHandle, name: String, data: Value) -> Result<(), String> {
    if !is_valid_state_name(&name) {
        return Err(format!("invalid state name: {name}"));
    }
    let dir = state_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".tmp-{}-{}-{}", name, std::process::id(), nonce));
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct PackEntry {
    pub id: String,
    pub dir: String,
    pub pack: Value,
}

fn list_packs(dir: &Path) -> Vec<PackEntry> {
    let mut packs = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return packs; // missing dir = no packs installed
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(entry.path().join("pack.json")) else {
            continue; // no pack.json, or unreadable — skip silently
        };
        let Ok(pack) = serde_json::from_str::<Value>(&raw) else {
            continue; // invalid JSON — skip silently
        };
        let dirname = entry.file_name().to_string_lossy().to_string();
        let id = pack
            .pointer("/meta/id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| dirname.clone());
        packs.push(PackEntry { id, dir: dirname, pack });
    }
    packs
}

#[tauri::command]
pub fn packs_list(app: AppHandle) -> Vec<PackEntry> {
    list_packs(&packs_dir(&app))
}

/// Join a request-supplied relative path onto the assets root, admitting only
/// Normal components — `..`, absolute paths, and prefixes are rejected outright.
fn safe_asset_path(assets_root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\0') {
        return None;
    }
    let relp = Path::new(rel);
    if relp.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for comp in relp.components() {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        return None;
    }
    Some(assets_root.join(out))
}

#[tauri::command]
pub fn pack_asset(
    app: AppHandle,
    pack_id: String,
    rel_path: String,
) -> Result<tauri::ipc::Response, String> {
    let pdir = packs_dir(&app);
    let pack = list_packs(&pdir)
        .into_iter()
        .find(|p| p.id == pack_id)
        .ok_or_else(|| "pack not found".to_string())?;
    let assets_root = pdir.join(&pack.dir).join("assets");
    let full =
        safe_asset_path(&assets_root, &rel_path).ok_or_else(|| "invalid asset path".to_string())?;
    let bytes = fs::read(&full).map_err(|_| "asset not found".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_names() {
        assert!(is_valid_state_name("save.json"));
        assert!(is_valid_state_name("srs.json"));
        assert!(is_valid_state_name("a-b_c.9"));
        assert!(!is_valid_state_name(""));
        assert!(!is_valid_state_name("../evil"));
        assert!(!is_valid_state_name("a/b"));
        assert!(!is_valid_state_name("a..b"));
        assert!(!is_valid_state_name("säve"));
    }

    #[test]
    fn asset_paths() {
        let root = Path::new("/tmp/assets");
        assert_eq!(
            safe_asset_path(root, "d.json"),
            Some(PathBuf::from("/tmp/assets/d.json"))
        );
        assert_eq!(
            safe_asset_path(root, "sub/dir/s.png"),
            Some(PathBuf::from("/tmp/assets/sub/dir/s.png"))
        );
        assert_eq!(safe_asset_path(root, "../pack.json"), None);
        assert_eq!(safe_asset_path(root, "a/../../b"), None);
        assert_eq!(safe_asset_path(root, "/etc/passwd"), None);
        assert_eq!(safe_asset_path(root, ""), None);
        assert_eq!(safe_asset_path(root, "."), None);
    }
}
