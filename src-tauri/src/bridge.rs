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
//!   otherwise, dev     → <repo>/packs (baked from CARGO_MANIFEST_DIR; `tauri dev` only)
//!   otherwise, release → <resource-dir>/packs (bundled via tauri.conf.json bundle.resources —
//!                        packs/ ships inside the .app, no install step needed)
//!   otherwise          → <app-data>/packs (manual drop-in fallback, e.g. a hand-copied pack)

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
    // Release bundles ship packs/ as a bundle resource (tauri.conf.json bundle.resources:
    // "../packs/" -> "packs"), landing at <App>.app/Contents/Resources/packs on macOS.
    // Read it straight from the bundle — no copy/install step, same as the dev branch above.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("packs");
        if bundled.is_dir() {
            return bundled;
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

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum StrictStateRead {
    Missing { found: bool },
    Found { found: bool, data: Value },
}

fn state_read_strict_at(dir: &Path, name: &str) -> Result<StrictStateRead, String> {
    if !is_valid_state_name(name) {
        return Err(format!("invalid state name: {name}"));
    }
    let raw = match fs::read_to_string(dir.join(name)) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StrictStateRead::Missing { found: false });
        }
        Err(e) => return Err(format!("failed to read state {name}: {e}")),
    };
    let data =
        serde_json::from_str(&raw).map_err(|e| format!("failed to parse state {name}: {e}"))?;
    Ok(StrictStateRead::Found { found: true, data })
}

/// Read state without collapsing corruption or filesystem failures into absence.
/// The explicit envelope preserves the distinction between a missing file and a
/// file whose valid JSON value is `null`.
#[tauri::command]
pub fn state_read_strict(app: AppHandle, name: String) -> Result<StrictStateRead, String> {
    state_read_strict_at(&state_dir(&app), &name)
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
    let dir = packs_dir(&app);
    let packs = list_packs(&dir);
    println!("[packs] {} found in {}", packs.len(), dir.display());
    packs
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

    fn scratch_dir(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fablewood-bridge-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create isolated test directory");
        dir
    }

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

    #[test]
    fn strict_read_distinguishes_missing_valid_and_json_null() {
        let dir = scratch_dir("strict-values");
        fs::write(dir.join("valid.json"), r#"{"chapter":"arrival"}"#).expect("write valid fixture");
        fs::write(dir.join("null.json"), "null").expect("write null fixture");

        let missing = serde_json::to_value(
            state_read_strict_at(&dir, "missing.json").expect("missing is a valid outcome"),
        )
        .expect("serialize missing envelope");
        assert_eq!(missing, serde_json::json!({ "found": false }));

        let valid = serde_json::to_value(
            state_read_strict_at(&dir, "valid.json").expect("valid state reads"),
        )
        .expect("serialize valid envelope");
        assert_eq!(
            valid,
            serde_json::json!({ "found": true, "data": { "chapter": "arrival" } })
        );

        let null = serde_json::to_value(
            state_read_strict_at(&dir, "null.json").expect("JSON null is valid JSON"),
        )
        .expect("serialize null envelope");
        assert_eq!(null, serde_json::json!({ "found": true, "data": null }));

        fs::remove_dir_all(dir).expect("remove isolated test directory");
    }

    #[test]
    fn strict_read_reports_malformed_and_directory_io_errors() {
        let dir = scratch_dir("strict-errors");
        fs::write(dir.join("malformed.json"), "{ definitely not json")
            .expect("write malformed fixture");
        fs::create_dir(dir.join("directory.json")).expect("create directory fixture");

        let malformed = state_read_strict_at(&dir, "malformed.json")
            .expect_err("malformed JSON must not look absent");
        assert!(malformed.contains("failed to parse state malformed.json"));

        let io_error = state_read_strict_at(&dir, "directory.json")
            .expect_err("a found but unreadable directory must not look absent");
        assert!(io_error.contains("failed to read state directory.json"));

        fs::remove_dir_all(dir).expect("remove isolated test directory");
    }
}
