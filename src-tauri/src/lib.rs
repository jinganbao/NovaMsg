mod db;

use db::MessageIdStore;
use tauri::{Manager, RunEvent, WindowEvent};

/// 获取或创建消息 ID（供前端调用）
#[tauri::command]
fn get_message_id(store: tauri::State<MessageIdStore>, name: String, msg_type: String) -> i32 {
    store.get_or_create_id(&name, &msg_type)
}

/// 清空本地保存的所有消息 ID
#[tauri::command]
fn clear_message_ids(store: tauri::State<MessageIdStore>) -> Result<usize, String> {
    store.clear_all().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("message_ids.db");
            app.manage(MessageIdStore::new(&db_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_message_id, clear_message_ids])
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
