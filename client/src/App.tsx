import { useState } from "react";
import { Socket } from "socket.io-client";
import LoginScreen from "./components/LoginScreen";
import LobbyScreen from "./components/LobbyScreen";
import GameRoom from "./components/GameRoom";
import { User, Room } from "./types";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // ログイン成功時の処理
  const handleLoginSuccess = (user: User, newSocket: Socket) => {
    setSocket(newSocket);
    setCurrentUser(user);
    setIsLoggedIn(true);

    // Socket.IO イベントリスナーを設定
    setupSocketListeners(newSocket);
  };

  // Socket.IO イベントリスナーの設定
  const setupSocketListeners = (sock: Socket) => {
    if (!sock) return;

    // オンラインユーザー一覧の更新
    sock.on("online_users_updated", (data: { onlineUsers: User[] }) => {
      // 必要に応じて状態を更新
      console.log("オンラインユーザー更新:", data.onlineUsers);
    });

    // ルームリストの更新
    sock.on("room_list_updated", (data: { availableRooms: Room[] }) => {
      console.log("ルームリスト更新:", data.availableRooms);
    });

    // ルーム作成成功
    sock.on("room_created", (data: { room: Room }) => {
      setCurrentRoom(data.room);
    });

    // ルーム参加成功
    sock.on("room_joined", (data: { room: Room }) => {
      setCurrentRoom(data.room);
    });

    // ゲーム開始
    sock.on("game_started", (data: { room: Room }) => {
      setCurrentRoom(data.room);
    });

    // エラー処理
    sock.on("error", (data: { message: string }) => {
      alert(`エラー: ${data.message}`);
    });
  };

  // ログアウト処理
  const handleLogout = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCurrentRoom(null);
  };

  // ルーム退出処理
  const handleLeaveRoom = () => {
    setCurrentRoom(null);
  };

  // Socket インスタンスを取得する関数（子コンポーネントで使用）
  const getSocket = () => socket;

  // ログイン画面
  if (!isLoggedIn) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // ゲームルーム画面
  if (currentRoom) {
    return (
      <GameRoom
        room={currentRoom}
        currentUser={currentUser!}
        onLeaveRoom={handleLeaveRoom}
        getSocket={getSocket}
      />
    );
  }

  // ロビー画面
  return (
    <LobbyScreen
      currentUser={currentUser!}
      onLogout={handleLogout}
      getSocket={getSocket}
      onRoomCreated={(room) => setCurrentRoom(room)}
      onRoomJoined={(room) => setCurrentRoom(room)}
    />
  );
}

export default App;

