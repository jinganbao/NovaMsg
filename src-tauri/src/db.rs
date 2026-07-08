use rusqlite::{params, Connection};
use std::sync::Mutex;

/// 消息 ID 持久化存储（SQLite）
pub struct MessageIdStore {
    conn: Mutex<Connection>,
}

impl MessageIdStore {
    pub fn new(db_path: &std::path::Path) -> Self {
        let conn = Connection::open(db_path).expect("无法打开 SQLite 数据库");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS message_ids (
                id      INTEGER PRIMARY KEY,
                name    TEXT    NOT NULL,
                msg_type TEXT   NOT NULL,
                UNIQUE(name, msg_type)
            )",
            [],
        )
        .expect("无法创建 message_ids 表");
        MessageIdStore {
            conn: Mutex::new(conn),
        }
    }

    /// 根据类型获取 ID 范围
    fn id_range(msg_type: &str) -> (i32, i32) {
        match msg_type {
            "S2P" => (1000, 4999),
            "P2S" => (5000, 9999),
            "C2S" => (10000, 19999),
            "S2C" => (20000, 29999),
            _ => (0, 0),
        }
    }

    /// 获取或创建消息 ID
    /// - 如果 (name, msg_type) 已存在，直接返回已有 ID
    /// - 否则在该类型 ID 范围内取 max+1 插入
    pub fn get_or_create_id(&self, name: &str, msg_type: &str) -> i32 {
        let conn = self.conn.lock().unwrap();
        let (min_id, max_id) = Self::id_range(msg_type);
        if min_id == 0 && max_id == 0 {
            return 0;
        }

        // 1. 查找是否已存在
        if let Ok(id) = conn.query_row(
            "SELECT id FROM message_ids WHERE name = ?1 AND msg_type = ?2",
            params![name, msg_type],
            |row| row.get::<_, i32>(0),
        ) {
            return id;
        }

        // 2. 查找该范围内最大 ID
        let current_max: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(id), ?1) FROM message_ids WHERE id >= ?2 AND id <= ?3",
                params![min_id - 1, min_id, max_id],
                |row| row.get(0),
            )
            .unwrap_or(min_id - 1);

        let next_id = if current_max >= min_id {
            current_max + 1
        } else {
            min_id
        };

        if next_id > max_id {
            return 0; // ID 范围耗尽
        }

        // 3. 插入新记录
        if conn
            .execute(
                "INSERT OR IGNORE INTO message_ids (id, name, msg_type) VALUES (?1, ?2, ?3)",
                params![next_id, name, msg_type],
            )
            .is_ok()
        {
            next_id
        } else {
            0
        }
    }

    /// 清空所有已分配的消息 ID
    pub fn clear_all(&self) -> Result<usize, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM message_ids", [])
    }
}
