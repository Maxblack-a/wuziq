import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconChevronLeft } from "./Icons";

// 战绩详情页:从"我的"页面点"战绩"进来。原来这些内容(胜/负/平/胜率
// 面板 + 完整对局记录列表)是直接摊在 ProfileScreen 里的,现在拆成独立
// 一页,ProfileScreen 只留一行摘要入口,点进来才看到完整明细。
export default function MatchHistoryScreen({ myId, onExit }) {
  useTelegramBackButton(onExit);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    supabase.from("profiles").select("wins, losses, draws").eq("id", myId).single()
      .then(({ data }) => setProfile(data));

    supabase
      .from("match_history")
      .select("*, p1:player1_id(display_name), p2:player2_id(display_name)")
      .or(`player1_id.eq.${myId},player2_id.eq.${myId}`)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setHistory(data || []));
  }, [myId]);

  const total = profile ? profile.wins + profile.losses + profile.draws : 0;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;

  return (
    <div>
      {!isInTelegram && (
        <div className="room-topbar" style={{ marginBottom: 4 }}>
          <button className="room-icon-btn" onClick={onExit} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
      )}

      <div className="menu-header">
        <h2>战绩</h2>
        <p className="muted">联机对战按胜负计入,人机对战不计分</p>
      </div>

      {profile && (
        <div className="panel" style={{ display: "flex", justifyContent: "space-around", marginBottom: 20 }}>
          <Stat label="胜" value={profile.wins} />
          <Stat label="负" value={profile.losses} />
          <Stat label="平" value={profile.draws} />
          <Stat label="胜率" value={`${winRate}%`} />
        </div>
      )}

      <p className="muted" style={{ marginBottom: 8 }}>最近对局</p>
      {history === null && <div style={{ textAlign: "center", padding: 40 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>}
      {history?.length === 0 && <p className="muted">还没有对局记录,去联机对战一局吧。</p>}
      {history?.map(h => {
        const isP1 = h.player1_id === myId;
        const opponentName = (isP1 ? h.p2 : h.p1)?.display_name || "对手";
        const delta = isP1 ? h.player1_exp_after - h.player1_exp_before : h.player2_exp_after - h.player2_exp_before;
        const outcome = h.winner === 0 ? "draw" : (h.winner === (isP1 ? 1 : 2) ? "win" : "lose");
        const reasonTag = h.end_reason === "forfeit" ? "认输" : h.end_reason === "disconnect" ? "断线判负" : null;
        return (
          <div key={h.id} className="mode-card" style={{ marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="title">对 {opponentName}{reasonTag && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>({reasonTag})</span>}</div>
              <div className="desc">{new Date(h.created_at).toLocaleDateString()}</div>
            </div>
            <div className="mono" style={{
              fontWeight: 700,
              color: outcome === "win" ? "var(--jade)" : outcome === "lose" ? "var(--amber)" : "var(--fg-muted)",
            }}>
              {outcome === "win" ? "胜" : outcome === "lose" ? "负" : "平"} {delta > 0 ? `+${delta}` : delta}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}
