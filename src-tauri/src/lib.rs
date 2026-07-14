use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::{Manager, RunEvent, WindowEvent};

#[derive(Debug, Deserialize)]
struct GeneratedFile {
    path: String,
    contents: String,
    #[serde(default)]
    skip_if_exists: bool,
}

#[derive(Debug, Serialize)]
struct WriteGeneratedFilesResult {
    written_files: Vec<String>,
    skipped_files: Vec<String>,
}

#[tauri::command]
fn write_generated_files(files: Vec<GeneratedFile>) -> Result<WriteGeneratedFilesResult, String> {
    let mut written_files = Vec::new();
    let mut skipped_files = Vec::new();

    for file in files {
        let path = Path::new(&file.path);
        if file.skip_if_exists && path.exists() {
            skipped_files.push(file.path);
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建目录失败 {}: {}", parent.display(), err))?;
        }

        fs::write(path, file.contents.as_bytes())
            .map_err(|err| format!("写入文件失败 {}: {}", path.display(), err))?;

        let read_back = fs::read_to_string(path)
            .map_err(|err| format!("写入后读取校验失败 {}: {}", path.display(), err))?;
        if read_back != file.contents {
            return Err(format!("写入内容校验失败 {}", path.display()));
        }

        written_files.push(file.path);
    }

    Ok(WriteGeneratedFilesResult {
        written_files,
        skipped_files,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![write_generated_files])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
