import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { OnlineUser, Room, GameType, RPSChoice } from "./types";
import { calculateRPSResult } from "./game/rps";
import {
  initDatabase,
  registerUser,
  authenticateUser,
  getUserById,
  updateUserPoints,
  getUserPoints,
} from "./db";
import fs from "fs";
import path from "path";

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

// データベースの初期化
try {
  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`データベースディレクトリを作成しました: ${dataDir}`);
  }
  initDatabase();
  console.log("データベースの初期化が完了しました");
} catch (error) {
  console.error("データベース初期化エラー:", error);
  process.exit(1);
}

const MAX_ONLINE_USERS = 8;

// インメモリデータストア（オンライン状態のみ）
const onlineUsers = new Map<string, OnlineUser>(); // socket.id -> OnlineUser
const rooms = new Map<string, Room>(); // room.id -> Room
const emailToSocketId = new Map<string, string>(); // email -> socket.id

// ルームIDを生成
function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// オンラインユーザー一覧を取得
function getOnlineUsersList(): OnlineUser[] {
  return Array.from(onlineUsers.values());
}

// 参加可能なルーム一覧を取得
function getAvailableRooms(): Room[] {
  return Array.from(rooms.values()).filter(
    (room) => room.status === "waiting" && room.players.length < 2
  );
}

// HTTP API: ユーザー登録（運営専用 - 管理パスワード必要）
// 通常のユーザー登録は無効化（運営が事前に登録するため）
app.post("/api/register", async (req, res) => {
  const { email, password, username, adminPassword } = req.body;

  // 管理パスワードのチェック
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin-secret-2025";
  
  if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ 
      success: false, 
      message: "ユーザー登録は運営のみが行えます" 
    });
  }

  if (!email || !password || !username) {
    return res.status(400).json({ success: false, message: "すべての項目を入力してください" });
  }

  const result = registerUser(email, password, username);
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// HTTP API: ログイン（認証のみ、Socket.IO接続は別）
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "メールアドレスとパスワードを入力してください" });
    }

    const result = authenticateUser(email, password);
    if (result.success && result.user) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error("ログインAPIエラー:", error);
    res.status(500).json({ 
      success: false, 
      message: `サーバーエラー: ${error instanceof Error ? error.message : "不明なエラー"}` 
    });
  }
});

// Socket.IO 接続処理
io.on("connection", (socket) => {
  console.log(`クライアント接続: ${socket.id}`);

  // ログイン処理（既にHTTP APIで認証済みのユーザーが接続）
  socket.on("login", (data: { userId: number; email: string }) => {
    // データベースからユーザー情報を取得
    const dbUser = getUserById(data.userId);
    if (!dbUser) {
      socket.emit("login_error", { message: "ユーザーが見つかりません" });
      return;
    }

    // 既にログインしているかチェック
    if (emailToSocketId.has(data.email)) {
      socket.emit("login_error", {
        message: "このアカウントは既にログインしています",
      });
      return;
    }

    // オンラインユーザー数のチェック
    if (onlineUsers.size >= MAX_ONLINE_USERS) {
      socket.emit("login_error", {
        message: "サーバーが満員です。しばらく待ってから再度お試しください",
      });
      return;
    }

    // オンラインユーザー情報を作成
    const onlineUser: OnlineUser = {
      id: socket.id,
      userId: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      points: dbUser.points,
    };

    onlineUsers.set(socket.id, onlineUser);
    emailToSocketId.set(data.email, socket.id);

    // ログイン成功を通知
    socket.emit("login_success", {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        username: dbUser.username,
        points: dbUser.points,
      },
      onlineUsers: getOnlineUsersList(),
      availableRooms: getAvailableRooms(),
    });

    // 他のユーザーに新しいユーザーの参加を通知
    socket.broadcast.emit("user_joined", {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        username: dbUser.username,
        points: dbUser.points,
      },
    });
    socket.broadcast.emit("online_users_updated", {
      onlineUsers: getOnlineUsersList(),
    });
  });

  // ルーム作成
  socket.on("create_room", (data: { gameType: GameType }) => {
    const user = onlineUsers.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    // データベースから最新のポイントを取得
    const currentPoints = getUserPoints(user.userId);
    if (currentPoints !== user.points) {
      user.points = currentPoints;
    }

    // じゃんけんの場合はベット額を100ptに固定
    const betAmount = data.gameType === "rps" ? 100 : 100;

    // ポイントチェック
    if (user.points < betAmount) {
      socket.emit("error", {
        message: `ポイントが不足しています（必要: ${betAmount}pt）`,
      });
      return;
    }

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
    const user = onlineUsers.get(socket.id);
    if (!user) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    // データベースから最新のポイントを取得
    const currentPoints = getUserPoints(user.userId);
    if (currentPoints !== user.points) {
      user.points = currentPoints;
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
        newPlayer: {
          id: user.userId,
          email: user.email,
          username: user.username,
          points: user.points,
        },
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

      const player1 = onlineUsers.get(player1Id);
      const player2 = onlineUsers.get(player2Id);

      if (!player1 || !player2) {
        socket.emit("error", { message: "プレイヤー情報が見つかりません" });
        return;
      }

      const gameResult = calculateRPSResult(
        player1Id,
        player1Choice,
        player2Id,
        player2Choice,
        room.betAmount
      );

      // ポイントを更新（データベースとメモリ）
      // pointsChangeのキーをsocket.idからuserIdに変換
      const pointsChangeByUserId: Record<number, number> = {};
      Object.entries(gameResult.pointsChange).forEach(([playerSocketId, change]) => {
        const player = onlineUsers.get(playerSocketId);
        if (player) {
          const newPoints = player.points + change;
          player.points = newPoints;
          // データベースに保存
          updateUserPoints(player.userId, newPoints);
          // userIdをキーにしたポイント変動を記録
          pointsChangeByUserId[player.userId] = change;
        }
      });

      // 結果を全員に通知
      io.to(room.id).emit("game_result", {
        roomId: room.id,
        result: {
          ...gameResult,
          pointsChange: pointsChangeByUserId, // userIdをキーにしたポイント変動
        },
        choices: {
          [player1Id]: player1Choice,
          [player2Id]: player2Choice,
        },
        updatedUsers: [
          {
            id: player1.userId,
            email: player1.email,
            username: player1.username,
            points: player1.points,
          },
          {
            id: player2.userId,
            email: player2.email,
            username: player2.username,
            points: player2.points,
          },
        ],
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
  socket.on("transfer_points", (data: { targetEmail: string; amount: number }) => {
    const sender = onlineUsers.get(socket.id);
    if (!sender) {
      socket.emit("error", { message: "ログインが必要です" });
      return;
    }

    if (data.amount <= 0) {
      socket.emit("error", { message: "譲渡額は1以上である必要があります" });
      return;
    }

    // データベースから最新のポイントを取得
    const currentPoints = getUserPoints(sender.userId);
    if (currentPoints !== sender.points) {
      sender.points = currentPoints;
    }

    if (sender.points < data.amount) {
      socket.emit("error", { message: "ポイントが不足しています" });
      return;
    }

    const targetSocketId = emailToSocketId.get(data.targetEmail);
    if (!targetSocketId) {
      socket.emit("error", { message: "対象ユーザーが見つかりません" });
      return;
    }

    const target = onlineUsers.get(targetSocketId);
    if (!target) {
      socket.emit("error", { message: "対象ユーザーはオンラインではありません" });
      return;
    }

    // データベースから対象ユーザーの最新ポイントを取得
    const targetCurrentPoints = getUserPoints(target.userId);
    if (targetCurrentPoints !== target.points) {
      target.points = targetCurrentPoints;
    }

    // ポイントを譲渡（データベースとメモリ）
    const senderNewPoints = sender.points - data.amount;
    const targetNewPoints = target.points + data.amount;

    sender.points = senderNewPoints;
    target.points = targetNewPoints;

    updateUserPoints(sender.userId, senderNewPoints);
    updateUserPoints(target.userId, targetNewPoints);

    // 両方のユーザーに通知
    socket.emit("transfer_success", {
      message: `${target.username} に ${data.amount}pt を譲渡しました`,
      updatedUser: {
        id: sender.userId,
        email: sender.email,
        username: sender.username,
        points: sender.points,
      },
    });

    io.to(targetSocketId).emit("points_received", {
      message: `${sender.username} から ${data.amount}pt を受け取りました`,
      updatedUser: {
        id: target.userId,
        email: target.email,
        username: target.username,
        points: target.points,
      },
    });

    // オンラインユーザー一覧を更新
    io.emit("online_users_updated", {
      onlineUsers: getOnlineUsersList(),
    });
  });

  // 切断処理
  socket.on("disconnect", () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      onlineUsers.delete(socket.id);
      emailToSocketId.delete(user.email);

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
        onlineUsers: getOnlineUsersList(),
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
