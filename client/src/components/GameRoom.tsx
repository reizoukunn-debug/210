import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
import { User, Room, RPSChoice } from "../types";

interface GameRoomProps {
  room: Room;
  currentUser: User;
  onLeaveRoom: () => void;
  getSocket: () => Socket | null;
}

function GameRoom({
  room,
  currentUser,
  onLeaveRoom,
  getSocket,
}: GameRoomProps) {
  const [myChoice, setMyChoice] = useState<RPSChoice | null>(null);
  const [gameResult, setGameResult] = useState<any>(null);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [updatedUsers, setUpdatedUsers] = useState<User[]>([]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // ゲーム開始
    socket.on("game_started", (_data: { room: Room }) => {
      setGameResult(null);
      setMyChoice(null);
      setWaitingForOpponent(false);
    });

    // ゲーム結果
    socket.on("game_result", (data: {
      roomId: string;
      result: any;
      choices: Record<string, RPSChoice>;
      updatedUsers: User[];
    }) => {
      setGameResult(data);
      setUpdatedUsers(data.updatedUsers);
      setWaitingForOpponent(false);
    });

    // ゲーム継続（引き分け）
    socket.on("game_continue", (_data: { room: Room }) => {
      setGameResult(null);
      setMyChoice(null);
      setWaitingForOpponent(false);
      alert("引き分け！再戦します。");
    });

    // 手を選択した通知
    socket.on("choice_received", (_data: { message: string }) => {
      setWaitingForOpponent(true);
    });

    // プレイヤー退出
    socket.on("player_left_room", (data: { room: Room; message: string }) => {
      alert(data.message);
      onLeaveRoom();
    });

    return () => {
      socket.off("game_started");
      socket.off("game_result");
      socket.off("game_continue");
      socket.off("choice_received");
      socket.off("player_left_room");
    };
  }, [getSocket, onLeaveRoom]);

  const handleChoice = (choice: RPSChoice) => {
    const socket = getSocket();
    if (!socket) return;

    setMyChoice(choice);
    socket.emit("rps_choice", { roomId: room.id, choice });
    setWaitingForOpponent(true);
  };

  const getChoiceLabel = (choice: RPSChoice): string => {
    switch (choice) {
      case "rock":
        return "グー";
      case "paper":
        return "パー";
      case "scissors":
        return "チョキ";
    }
  };

  const getChoiceEmoji = (choice: RPSChoice): string => {
    switch (choice) {
      case "rock":
        return "✊";
      case "paper":
        return "✋";
      case "scissors":
        return "✌️";
    }
  };

  // 待機中（相手を待っている）
  if (room.status === "waiting") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            ルーム待機中
          </h2>
          <p className="text-gray-600 mb-6">
            他のプレイヤーの参加を待っています...
          </p>
          <p className="text-sm text-gray-500 mb-4">
            ベット額: {room.betAmount}pt
          </p>
          <button
            onClick={onLeaveRoom}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition"
          >
            ルームを退出
          </button>
        </div>
      </div>
    );
  }

  // ゲーム中
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* ヘッダー */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">
              {room.gameType === "rps" ? "じゃんけん" : room.gameType}
            </h2>
            <button
              onClick={onLeaveRoom}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md transition"
            >
              退出
            </button>
          </div>

          <div className="text-center mb-6">
            <p className="text-lg text-gray-600">
              ベット額: <span className="font-bold text-blue-600">{room.betAmount}pt</span>
            </p>
          </div>

          {/* ゲーム結果表示 */}
          {gameResult && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">
                結果
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                {Object.entries(gameResult.choices).map(([playerId, choice]) => {
                  const player = updatedUsers.find((u) => u.id === playerId);
                  const isMe = playerId === currentUser.id;
                  return (
                    <div
                      key={playerId}
                      className={`p-4 rounded ${
                        isMe ? "bg-blue-100" : "bg-gray-100"
                      }`}
                    >
                      <div className="text-center">
                        <div className="text-4xl mb-2">
                          {getChoiceEmoji(choice as RPSChoice)}
                        </div>
                        <div className="font-medium">
                          {isMe ? "あなた" : player?.username || "相手"}
                        </div>
                        <div className="text-sm text-gray-600">
                          {getChoiceLabel(choice as RPSChoice)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {gameResult.result.isDraw ? (
                <div className="text-center text-lg font-bold text-gray-600">
                  引き分け！
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600 mb-2">
                    {gameResult.result.winnerId === currentUser.id
                      ? "あなたの勝ち！"
                      : "あなたの負け..."}
                  </div>
                  <div className="text-sm text-gray-600">
                    ポイント変動:{" "}
                    {gameResult.result.pointsChange[currentUser.id] > 0
                      ? "+"
                      : ""}
                    {gameResult.result.pointsChange[currentUser.id]}pt
                  </div>
                </div>
              )}
              {/* 更新されたユーザー情報 */}
              {updatedUsers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-600">
                    {updatedUsers.map((user) => (
                      <div key={user.id} className="flex justify-between">
                        <span>{user.username}</span>
                        <span className="font-bold">{user.points}pt</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 手の選択（ゲーム中でまだ選択していない場合） */}
          {room.status === "playing" && !myChoice && !waitingForOpponent && (
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">
                手を選んでください
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <button
                  onClick={() => handleChoice("rock")}
                  className="bg-gray-200 hover:bg-gray-300 p-6 rounded-lg text-6xl transition"
                >
                  ✊
                </button>
                <button
                  onClick={() => handleChoice("paper")}
                  className="bg-gray-200 hover:bg-gray-300 p-6 rounded-lg text-6xl transition"
                >
                  ✋
                </button>
                <button
                  onClick={() => handleChoice("scissors")}
                  className="bg-gray-200 hover:bg-gray-300 p-6 rounded-lg text-6xl transition"
                >
                  ✌️
                </button>
              </div>
            </div>
          )}

          {/* 相手の選択待ち */}
          {waitingForOpponent && (
            <div className="text-center py-8">
              <div className="text-lg text-gray-600 mb-2">
                あなたの選択: {myChoice ? getChoiceEmoji(myChoice) : ""}{" "}
                {myChoice ? getChoiceLabel(myChoice) : ""}
              </div>
              <div className="text-gray-500">相手の選択を待っています...</div>
            </div>
          )}

          {/* ゲーム終了後の再戦ボタン（必要に応じて） */}
          {room.status === "finished" && gameResult && !gameResult.result.isDraw && (
            <div className="text-center mt-6">
              <button
                onClick={() => {
                  setGameResult(null);
                  setMyChoice(null);
                  setWaitingForOpponent(false);
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md transition"
              >
                ルームに戻る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GameRoom;

