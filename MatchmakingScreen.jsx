import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTelegramBackButton } from "../lib/telegram";

export default function MatchmakingScreen({ myId, onMatched, onExit, onFallbackToPve }) {
  useTelegramBackButton(onExit);
  const [status, setStatus] = useState("matching"); // matching | waiting
  const [elapsed, setElapsed] = useState(0);
  const channelsRef = useRef([]);
  const triedRef = useRef(false);
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function tryMatch() {
      if (triedRef.current) return;
      triedRef.current = true;

      const { data: roomId, error } = await supabase.rpc("match_players", {
        me: myId,
        my_rating: 1200,
      });

      if (cancelled) return;

      if (error) {
        console.error(error);
        return;
      }

      if (roomId) {
        onMatchedRef.current(roomId);
        return;
      }

      // 没配到,进入等待,监听是否有人把我拉进了新房间
      setStatus("waiting");
      const c1 = supabase
        .channel(`mm-p1-${myId}`)
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "rooms", filter: `player1_id=eq.${myId}` },
          (payload) => onMatchedRef.current(payload.new.id)
        ).subscribe();

      const c2 = supabase
        .channel(`mm-p2-${myId}`)
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "rooms", filter: `player2_id=eq.${myId}` },
          (payload) => onMatchedRef.current(payload.new.id)
        ).subscribe();

      channelsRef.current = [c1, c2];
    }

    tryMatch();

    return () => {
      cancelled = true;
      channelsRef.current.forEach(c => supabase.removeChannel(c));
      supabase.from("matchmaking_queue").delete().eq("player_id", myId).then(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]); // 只在挂载时跑一次;onMatched 通过 ref 访问,不放进依赖数组里

  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");

  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div className="spinner" style={{ margin: "0 auto 20px" }} />
      <h2>{status === "waiting" ? "正在等待对手" : "匹配中…"}</h2>
      <p className="mono muted" style={{ marginTop: 8, fontSize: 18 }}>{mins}:{secs}</p>

      {elapsed >= 20 && elapsed < 45 && (
        <p className="muted" style={{ marginTop: 8 }}>当前在线玩家可能比较少,可以再等等</p>
      )}
      {elapsed >= 45 && (
        <div className="panel" style={{ marginTop: 20, textAlign: "center" }}>
          <p className="muted">一直没匹配到人,要不先来一局人机练练手?切换过去会退出当前排队,想再匹配可以回来重新点。</p>
          <button className="btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={onFallbackToPve}>
            先玩人机对战
          </button>
        </div>
      )}

      <button className="btn-ghost" style={{ marginTop: 20 }} onClick={onExit}>取消匹配</button>
    </div>
  );
}
