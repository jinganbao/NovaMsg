mod db;

use db::MessageIdStore;
use tauri::Manager;

/// 获取或创建消息 ID（供前端调用）
#[tauri::command]
fn get_message_id(
    store: tauri::State<MessageIdStore>,
    name: String,
    msg_type: String,
) -> i32 {
    store.get_or_create_id(&name, &msg_type)
}

/// 清空本地保存的所有消息 ID
#[tauri::command]
fn clear_message_ids(store: tauri::State<MessageIdStore>) -> Result<usize, String> {
    store.clear_all().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("message_ids.db");
            app.manage(MessageIdStore::new(&db_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_message_id, clear_message_ids])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
