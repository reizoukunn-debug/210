import { useState } from "react";
import { io, Socket } from "socket.io-client";
import { User } from "../types";
import { API_URL } from "../config";

interface LoginScreenProps {
  onLoginSuccess: (user: User, socket: Socket) => void;
}

function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // HTTP APIでログイン（認証）
      const response = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      // レスポンスが正常でない場合
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "サーバーエラーが発生しました" }));
        setError(errorData.message || `サーバーエラー (${response.status})`);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (!data.success || !data.user) {
        setError(data.message || "ログインに失敗しました");
        setLoading(false);
        return;
      }

      // Socket.IO 接続を確立
      const socket = io(API_URL);

      // Socket.IOでログイン（接続）
      socket.emit("login", { userId: data.user.id, email: data.user.email });

      // ログイン成功
      socket.once("login_success", (socketData: {
        user: User;
        onlineUsers: User[];
        availableRooms: any[];
      }) => {
        setLoading(false);
        // 初期データを socket に保存（LobbyScreen で使用）
        (socket as any).initialData = {
          onlineUsers: socketData.onlineUsers,
          availableRooms: socketData.availableRooms,
        };
        onLoginSuccess(socketData.user, socket);
      });

      // ログインエラー
      socket.once("login_error", (errorData: { message: string }) => {
        setError(errorData.message);
        setLoading(false);
        socket.disconnect();
      });
    } catch (err) {
      console.error("ログインエラー:", err);
      const errorMessage = err instanceof Error 
        ? `接続エラー: ${err.message}` 
        : "ログインに失敗しました。ネットワーク接続を確認してください。";
      setError(`${errorMessage} (API: ${API_URL})`);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">
          ポイント制ミニゲーム
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="メールアドレスを入力"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              パスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="パスワードを入力"
            />
          </div>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-gray-600">
          <p>アカウント登録は運営が行います</p>
          <p className="text-xs mt-1">メールアドレスとパスワードをお持ちの方はログインしてください</p>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
