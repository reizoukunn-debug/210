import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import path from "path";
import fs from "fs";

// データベースファイルのパス
const DB_DIR = process.env.DB_DIR || path.join(__dirname, "../data");
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, "minigame.db");

// データベースディレクトリが存在しない場合は作成
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// データベース接続
let db: Database.Database;
try {
  db = new Database(DB_PATH);
  console.log(`データベースに接続しました: ${DB_PATH}`);
} catch (error) {
  console.error("データベース接続エラー:", error);
  throw error;
}
export { db };

// データベースの初期化
export function initDatabase() {
  // ユーザーテーブルの作成
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT NOT NULL,
      points INTEGER DEFAULT 1000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_email ON users(email);
  `);

  console.log("データベースを初期化しました");
}

// ユーザーを登録
export function registerUser(
  email: string,
  password: string,
  username: string
): { success: boolean; message: string; userId?: number } {
  try {
    // メールアドレスの重複チェック
    const existingUser = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);

    if (existingUser) {
      return { success: false, message: "このメールアドレスは既に登録されています" };
    }

    // ユーザー名の重複チェック
    const existingUsername = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username);

    if (existingUsername) {
      return { success: false, message: "このユーザー名は既に使用されています" };
    }

    // パスワードをハッシュ化
    const passwordHash = bcrypt.hashSync(password, 10);

    // ユーザーを登録
    const result = db
      .prepare(
        "INSERT INTO users (email, password_hash, username, points) VALUES (?, ?, ?, 1000)"
      )
      .run(email, passwordHash, username);

    return {
      success: true,
      message: "ユーザー登録が完了しました",
      userId: Number(result.lastInsertRowid),
    };
  } catch (error) {
    console.error("ユーザー登録エラー:", error);
    return { success: false, message: "ユーザー登録に失敗しました" };
  }
}

// ユーザーを認証（ログイン）
export function authenticateUser(
  email: string,
  password: string
): { success: boolean; message: string; user?: any } {
  try {
    // ユーザーを取得
    const user = db
      .prepare("SELECT id, email, username, password_hash, points FROM users WHERE email = ?")
      .get(email) as
      | {
          id: number;
          email: string;
          username: string;
          password_hash: string;
          points: number;
        }
      | undefined;

    if (!user) {
      return { success: false, message: "メールアドレスまたはパスワードが正しくありません" };
    }

    // パスワードを検証
    const isValidPassword = bcrypt.compareSync(password, user.password_hash);

    if (!isValidPassword) {
      return { success: false, message: "メールアドレスまたはパスワードが正しくありません" };
    }

    // パスワードハッシュを除外して返す
    const { password_hash, ...userWithoutPassword } = user;

    return {
      success: true,
      message: "ログインに成功しました",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        points: user.points,
      },
    };
  } catch (error) {
    console.error("認証エラー:", error);
    return { success: false, message: "ログインに失敗しました" };
  }
}

// ユーザー情報を取得
export function getUserById(userId: number) {
  const user = db
    .prepare("SELECT id, email, username, points FROM users WHERE id = ?")
    .get(userId) as
    | {
        id: number;
        email: string;
        username: string;
        points: number;
      }
    | undefined;

  return user;
}

// ユーザーのポイントを更新
export function updateUserPoints(userId: number, newPoints: number) {
  db.prepare("UPDATE users SET points = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    newPoints,
    userId
  );
}

// ユーザーのポイントを取得
export function getUserPoints(userId: number): number {
  const user = db
    .prepare("SELECT points FROM users WHERE id = ?")
    .get(userId) as { points: number } | undefined;

  return user?.points || 0;
}

