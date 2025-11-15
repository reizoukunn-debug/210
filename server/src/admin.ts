import { registerUser } from "./db";

/**
 * 運営が事前にユーザーを登録するためのスクリプト
 * 使用方法: npm run admin:add-user <email> <password> <username>
 */
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log("使用方法: npm run admin:add-user <email> <password> <username>");
  console.log("例: npm run admin:add-user user@example.com password123 ユーザー名");
  process.exit(1);
}

const [email, password, username] = args;

const result = registerUser(email, password, username);

if (result.success) {
  console.log(`✅ ユーザー登録成功:`);
  console.log(`   メールアドレス: ${email}`);
  console.log(`   ユーザー名: ${username}`);
  console.log(`   ユーザーID: ${result.userId}`);
  console.log(`   初期ポイント: 1000pt`);
} else {
  console.error(`❌ ユーザー登録失敗: ${result.message}`);
  process.exit(1);
}

