import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { User, Room, GameType, RPSChoice } from "./types";
import { calculateRPSResult } from "./game/rps";

const app = express();
const httpServer = createServer(app);

// 環境変数からフロントエンドURLを取得（デフォルトはlocalhost）
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// CORS設定
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());

// 共通パスワード（ハードコード）
const COMMON_PASSWORD = "only-friends-2025";
const INITIAL_POINTS = 1000;
const MAX_ONLINE_USERS = 8;

// インメモリデータストア
const users = new Map<string, User>(); // socket.id -> User
const rooms = new Map<string, Room>(); // room.id -> Room
const usernameToSocketId = new Map<string, string>(); // username -> socket.id

// ユーザー名が既に使用されているかチェック
function isUsernameTaken(username: string): boolean {
  return usernameToSocketId.has(username);
}

// ルームIDを生成
function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// オンラインユーザー一覧を取得
function getOnlineUsers(): User[] {
  return Array.from(users.values());
}

// 参加可能なルーム一覧を取得
function getAvailableRooms(): Room[] {
  return Array.from(rooms.values()).filter(
    (room) => room.status === "waiting" && room.players.length < 2
  );
}

// Socket.IO 接続処理
io.on("connection", (socket) => {
  console.log(`クライアント接続: ${socket.id}`);

  // ログイン処理
  socket.on("login", (data: { username: string; password: string }) => {
    // パスワードチェック
    if (data.password !== COMMON_PASSWORD) {
      socket.emit("login_error", { message: "パスワードが正しくありません" });
      return;
    }

    // ユーザー名の重複チェック
    if (isUsernameTaken(data.username)) {
      socket.emit("login_error", {
        message: "このユーザー名は既に使用されています",
      });
      return;
    }

    // オンラインユーザー数のチェック
    if (users.size >= MAX_ONLINE_USERS) {
      socket.emit("login_error", {
        message: "サーバーが満員です。しばらく待ってから再度お試しください",
      });
      return;
    }

    // ユーザー情報を作成
    const user: User = {
      id: socket.id,
      username: data.username,
      points: INITIAL_POINTS,
    };

    users.set(socket.id, user);
    usernameToSocketId.set(data.username, socket.id);

    // ログイン成功を通知
    socket.emit("login_success", {
      user,
      onlineUsers: getOnlineUsers(),
      availableRooms: getAvailableRooms(),
    });

    // 他のユーザーに新しいユーザーの参加を通知
    socket.broadcast.emit("user_joined", { user });
    socket.broadcast.emit("online_users_updated", {
      onlineUsers: getOnlineUsers(),
    });
  });

  // ルーム作成
  socket.on("create_room", (data: { gameType: GameType }) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    // じゃんけんの場合はベット額を100ptに固定
    const betAmount = data.gameType === "rps" ? 100 : 100;

    const room: Room = {
      id: generateRoomId(),
      gameType: data.gameType,
      hostId: socket.id,
      players: [socket.id],
      status: "waiting",
      betAmount,
    };

    rooms.set(room.id, room);
    socket.join(room.id);

    socket.emit("room_created", { room });
    socket.broadcast.emit("room_list_updated", {
      availableRooms: getAvailableRooms(),
    });
  });

  // ルーム参加
  socket.on("join_room", (data: { roomId: string }) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit("error", { message: "ルームが見つかりません" });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("error", { message: "ルームが満員です" });
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("error", { message: "このルームには参加できません" });
      return;
    }

    // ポイントチェック
    if (user.points < room.betAmount) {
      socket.emit("error", {
        message: `ポイントが不足しています（必要: ${room.betAmount}pt）`,
      });
      return;
    }

    room.players.push(socket.id);
    socket.join(room.id);

    // 必要人数が揃ったらゲーム開始
    if (room.players.length === 2) {
      room.status = "playing";
      io.to(room.id).emit("game_started", { room });
    } else {
      socket.emit("room_joined", { room });
      socket.broadcast.to(room.id).emit("player_joined_room", {
        room,
        newPlayer: user,
      });
    }

    socket.broadcast.emit("room_list_updated", {
      availableRooms: getAvailableRooms(),
    });
  });

  // じゃんけんの手を送信
  socket.on("rps_choice", (data: { roomId: string; choice: RPSChoice }) => {
    const room = rooms.get(data.roomId);
    if (!room || room.gameType !== "rps") {
      socket.emit("error", { message: "無効なルームです" });
      return;
    }

    if (!room.players.includes(socket.id)) {
      socket.emit("error", { message: "このルームに参加していません" });
      return;
    }

    // ゲームデータを初期化（初回の場合）
    if (!room.gameData) {
      room.gameData = {};
    }

    // プレイヤーの手を記録
    room.gameData[socket.id] = data.choice;

    // 全員の手が揃ったかチェック
    if (
      room.gameData[room.players[0]] &&
      room.gameData[room.players[1]]
    ) {
      // 勝敗判定
      const player1Id = room.players[0];
      const player2Id = room.players[1];
      const player1Choice = room.gameData[player1Id] as RPSChoice;
      const player2Choice = room.gameData[player2Id] as RPSChoice;

      const gameResult = calculateRPSResult(
        player1Id,
        player1Choice,
        player2Id,
        player2Choice,
        room.betAmount
      );

      // ポイントを更新
      Object.entries(gameResult.pointsChange).forEach(([playerId, change]) => {
        const player = users.get(playerId);
        if (player) {
          player.points += change;
        }
      });

      // 結果を全員に通知
      io.to(room.id).emit("game_result", {
        roomId: room.id,
        result: gameResult,
        choices: {
          [player1Id]: player1Choice,
          [player2Id]: player2Choice,
        },
        updatedUsers: [
          users.get(player1Id),
          users.get(player2Id),
        ].filter(Boolean),
      });

      // 引き分けの場合は継続、そうでなければ終了
      if (gameResult.isDraw) {
        // 引き分け：ゲームデータをリセットして再戦
        room.gameData = {};
        room.status = "playing";
        io.to(room.id).emit("game_continue", { room });
      } else {
        // 勝敗が決まった：ルームを終了状態に
        room.status = "finished";
      }
    } else {
      // まだ全員の手が揃っていない：待機中であることを通知
      socket.emit("choice_received", { message: "手を選択しました。相手の選択を待っています..." });
    }
  });

  // ポイント譲渡
  socket.on("transfer_points", (data: { targetUsername: string; amount: number }) => {
    const sender = users.get(socket.id);
    if (!sender) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    if (data.amount <= 0) {
      socket.emit("error", { message: "譲渡額は1以上である必要があります" });
      return;
    }

    if (sender.points < data.amount) {
      socket.emit("error", { message: "ポイントが不足しています" });
      return;
    }

    const targetSocketId = usernameToSocketId.get(data.targetUsername);
    if (!targetSocketId) {
      socket.emit("error", { message: "対象ユーザーが見つかりません" });
      return;
    }

    const target = users.get(targetSocketId);
    if (!target) {
      socket.emit("error", { message: "対象ユーザーはオンラインではありません" });
      return;
    }

    // ポイントを譲渡
    sender.points -= data.amount;
    target.points += data.amount;

    // 両方のユーザーに通知
    socket.emit("transfer_success", {
      message: `${data.targetUsername} に ${data.amount}pt を譲渡しました`,
      updatedUser: sender,
    });

    io.to(targetSocketId).emit("points_received", {
      message: `${sender.username} から ${data.amount}pt を受け取りました`,
      updatedUser: target,
    });

    // オンラインユーザー一覧を更新
    io.emit("online_users_updated", {
      onlineUsers: getOnlineUsers(),
    });
  });

  // 切断処理
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      usernameToSocketId.delete(user.username);

      // 参加中のルームから退出
      rooms.forEach((room) => {
        if (room.players.includes(socket.id)) {
          room.players = room.players.filter((id) => id !== socket.id);
          if (room.players.length === 0) {
            rooms.delete(room.id);
          } else {
            // 残りのプレイヤーに通知
            io.to(room.id).emit("player_left_room", {
              room,
              message: `${user.username} が退出しました`,
            });
            room.status = "waiting";
          }
        }
      });

      // 他のユーザーに通知
      socket.broadcast.emit("user_left", { username: user.username });
      socket.broadcast.emit("online_users_updated", {
        onlineUsers: getOnlineUsers(),
      });
      socket.broadcast.emit("room_list_updated", {
        availableRooms: getAvailableRooms(),
      });
    }

    console.log(`クライアント切断: ${socket.id}`);
  });
});

// ポート番号を環境変数から取得（Render/Fly.ioなどで自動設定される）
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`サーバー起動: http://0.0.0.0:${PORT}`);
  console.log(`フロントエンドURL: ${FRONTEND_URL}`);
});

