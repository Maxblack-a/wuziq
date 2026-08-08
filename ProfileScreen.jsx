import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTelegramBackButton } from "../lib/telegram";

export default function ProfileScreen({ myId, onExit }) {
  useTelegramBackButton(onExit);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", myId).single()
      .then(({ data }) => setProfile(data));

    supabase
      .from("match_history")
      .select("*, p1:player1_id(display_name), p2:player2_id(display_name)")
      .or(`player1_id.eq.${myId},player2_id.eq.${myId}`)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory(data || []));
  }, [myId]);

  if (!profile) return <div style={{ textAlign: "center", padding: 60 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>;

  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;

  return (
    <div>
      <button className="btn-ghost" onClick={onExit}>← 返回</button>
      <div className="menu-header">
        <h2>{profile.display_name || "玩家"}</h2>
        <p className="mono" style={{ fontSize: 32, color: "var(--jade)", marginTop: 8 }}>{profile.rating}</p>
        <p className="muted">积分</p>
      </div>

      <div className="panel" style={{ display: "flex", justifyContent: "space-around", marginBottom: 20 }}>
        <Stat label="胜" value={profile.wins} />
        <Stat label="负" value={profile.losses} />
        <Stat label="平" value={profile.draws} />
        <Stat label="胜率" value={`${winRate}%`} />
      </div>

      <p className="muted" style={{ marginBottom: 8 }}>最近对局</p>
      {history.length === 0 && <p className="muted">还没有对局记录,去联机对战一局吧。</p>}
      {history.map(h => {
        const isP1 = h.player1_id === myId;
        const opponentName = (isP1 ? h.p2 : h.p1)?.display_name || "对手";
        const delta = isP1 ? h.player1_rating_after - h.player1_rating_before : h.player2_rating_after - h.player2_rating_before;
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
