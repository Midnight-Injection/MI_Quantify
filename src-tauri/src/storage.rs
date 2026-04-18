use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

pub const APP_DATA_DIR_NAME: &str = ".mi_quantify";
pub const LEGACY_APP_DATA_DIR_NAME: &str = "mi_quantify";

pub fn resolve_home_dir() -> Option<PathBuf> {
    dirs::home_dir()
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            let drive = env::var_os("HOMEDRIVE")?;
            let path = env::var_os("HOMEPATH")?;
            let mut home = PathBuf::from(drive);
            home.push(path);
            Some(home)
        })
}

pub fn ensure_app_data_dir() -> io::Result<PathBuf> {
    let home =
        resolve_home_dir().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "home dir"))?;
    let target_dir = home.join(APP_DATA_DIR_NAME);
    let legacy_dir = home.join(LEGACY_APP_DATA_DIR_NAME);

    migrate_dir_if_needed(&legacy_dir, &target_dir)?;
    fs::create_dir_all(&target_dir)?;
    Ok(target_dir)
}

pub fn app_data_file(file_name: &str) -> io::Result<PathBuf> {
    Ok(ensure_app_data_dir()?.join(file_name))
}

pub fn legacy_file(file_name: &str) -> Option<PathBuf> {
    resolve_home_dir().map(|home| home.join(LEGACY_APP_DATA_DIR_NAME).join(file_name))
}

pub fn app_support_candidates(app: &AppHandle, file_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(dir) = app.path().app_data_dir() {
        candidates.push(dir.join(file_name));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(home) = resolve_home_dir() {
            let identifier = app.config().identifier.clone();
            candidates.push(
                home.join("AppData")
                    .join("Roaming")
                    .join(&identifier)
                    .join(file_name),
            );
            candidates.push(
                home.join("AppData")
                    .join("Local")
                    .join(&identifier)
                    .join(file_name),
            );
        }
    }

    dedupe_paths(candidates)
}

pub fn migrate_file_if_missing(target: &Path, candidates: &[PathBuf]) -> io::Result<()> {
    if target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    for candidate in candidates {
        if candidate == target || !candidate.exists() || candidate.is_dir() {
            continue;
        }
        fs::copy(candidate, target)?;
        break;
    }

    Ok(())
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut unique = Vec::new();

    for path in paths {
        if unique.iter().any(|existing| existing == &path) {
            continue;
        }
        unique.push(path);
    }

    unique
}

fn migrate_dir_if_needed(source: &Path, target: &Path) -> io::Result<()> {
    if target.exists() || !source.exists() {
        return Ok(());
    }

    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(_) => {
            copy_dir_all(source, target)?;
            let _ = fs::remove_dir_all(source);
            Ok(())
        }
    }
}

fn copy_dir_all(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir_all(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
        }
    }

    Ok(())
}
