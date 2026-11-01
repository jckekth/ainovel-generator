//! Rust side of the app. It stays small on purpose: the React side does the
//! file storage and API calls through Tauri plugins. The only custom commands
//! here keep the user's API keys in the operating system's credential store
//! (Windows Credential Manager on Windows, the Secret Service such as GNOME
//! Keyring or KWallet on Linux) instead of a plain file: the text AI's key and
//! the image provider's key (spec 14.1), each under its own account. At start it
//! also moves the data from the folder earlier builds used (decision 154).

use std::path::Path;

use keyring::Entry;
use tauri::Manager;

/// The data folder's name inside the system's data folder; the same as DATA_FOLDER in src/lib/storage.ts.
const DATA_FOLDER: &str = "ainovelgenerator";
/// What the app keeps in its data folder, and so what is moved from the old one.
const DATA_ITEMS: [&str; 2] = ["app-settings.json", "stories"];

const SERVICE: &str = "ai-novel-generator";
const ACCOUNT: &str = "api-key";
const IMAGE_ACCOUNT: &str = "image-api-key";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

fn set_key(account: &str, key: &str) -> Result<(), String> {
    entry(account)?.set_password(key).map_err(|e| e.to_string())
}

fn get_key(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_key(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    set_key(ACCOUNT, &key)
}

#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
    get_key(ACCOUNT)
}

#[tauri::command]
fn delete_api_key() -> Result<(), String> {
    delete_key(ACCOUNT)
}

#[tauri::command]
fn set_image_key(key: String) -> Result<(), String> {
    set_key(IMAGE_ACCOUNT, &key)
}

#[tauri::command]
fn get_image_key() -> Result<Option<String>, String> {
    get_key(IMAGE_ACCOUNT)
}

#[tauri::command]
fn delete_image_key() -> Result<(), String> {
    delete_key(IMAGE_ACCOUNT)
}

/// Moves the data from the old folder (named after the bundle identifier) to the
/// new one, once: only when the new folder holds none of it, so nothing is ever
/// written over. Here in Rust, so the window needs no access to the old folder.
/// A failed move leaves the old files in place and the app starts empty.
fn move_old_data(old: &Path, new: &Path) {
    if DATA_ITEMS.iter().any(|item| new.join(item).exists()) {
        return;
    }
    if !DATA_ITEMS.iter().any(|item| old.join(item).exists()) {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(new) {
        eprintln!("Could not make the data folder {}: {e}", new.display());
        return;
    }
    for item in DATA_ITEMS {
        let from = old.join(item);
        if from.exists() {
            if let Err(e) = std::fs::rename(&from, new.join(item)) {
                eprintln!("Could not move {} to {}: {e}", from.display(), new.display());
            }
        }
    }
    // Only removes the old folder when nothing else is left in it.
    let _ = std::fs::remove_dir(old);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path();
            if let (Ok(old), Ok(data)) = (path.app_data_dir(), path.data_dir()) {
                move_old_data(&old, &data.join(DATA_FOLDER));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            get_api_key,
            delete_api_key,
            set_image_key,
            get_image_key,
            delete_image_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fresh(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ang-move-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_settings_and_stories_and_removes_the_empty_old_folder() {
        let root = fresh("move");
        let (old, new) = (root.join("com.jckek.ainovelgenerator"), root.join(DATA_FOLDER));
        fs::create_dir_all(old.join("stories/a")).unwrap();
        fs::write(old.join("app-settings.json"), "{}").unwrap();
        fs::write(old.join("stories/a/story.json"), "{}").unwrap();
        move_old_data(&old, &new);
        assert!(new.join("app-settings.json").exists());
        assert!(new.join("stories/a/story.json").exists());
        assert!(!old.exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn keeps_other_files_and_the_old_folder() {
        let root = fresh("keep");
        let (old, new) = (root.join("old"), root.join(DATA_FOLDER));
        fs::create_dir_all(old.join("EBWebView")).unwrap();
        fs::write(old.join("app-settings.json"), "{}").unwrap();
        move_old_data(&old, &new);
        assert!(new.join("app-settings.json").exists());
        assert!(old.join("EBWebView").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn never_writes_over_a_new_folder_that_has_data() {
        let root = fresh("over");
        let (old, new) = (root.join("old"), root.join(DATA_FOLDER));
        fs::create_dir_all(old.join("stories/a")).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("app-settings.json"), "new").unwrap();
        move_old_data(&old, &new);
        assert!(old.join("stories/a").exists());
        assert!(!new.join("stories").exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
