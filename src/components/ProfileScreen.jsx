import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTelegramBackButton } from "../lib/telegram";
import { IconPencil, IconCheck, IconClose } from "./Icons";

export default function ProfileScreen({ myId, onExit }) {
  useTelegramBackButton(onExit);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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

  function startEditing() {
    setDraftName(profile.display_name || "");
    setErrorMsg("");
    setEditing(true);
  }

  async function saveEditing() {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setErrorMsg("昵称不能为空");
      return;
    }
    if (trimmed === profile.display_name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErrorMsg("");
    const { error } = await supabase.from("profiles").update({ display_name: trimmed }).eq("id", myId);
    setSaving(false);
    if (error) {
      setErrorMsg("保存失败,请重试");
      return;
    }
    setProfile((prev) => ({ ...prev, display_name: trimmed }));
    setEditing(false);
  }

  if (!profile) return <div style={{ textAlign: "center", padding: 60 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>;

  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const joinedDate = profile.created_at ? new Date(profile.created_at).toLocaleDateString() : null;

  return (
    <div>
      {/* 原来这里有一个"← 返回"按钮,现在去掉了——Telegram 自带的返回键
          已经接了同一个 onExit(见上面 useTelegramBackButton),UI 上
          没必要再重复一份 */}
      <div className="menu-header">
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => { setDraftName(e.target.value); setErrorMsg(""); }}
              maxLength={20}
              disabled={saving}
              style={{
                fontSize: 20, fontWeight: 700, textAlign: "center", padding: "6px 10px",
                background: "var(--wood-soft)", color: "var(--fg)", border: "1px solid var(--ink-line)",
                borderRadius: "var(--radius-sm)", width: 160,
              }}
            />
            <button className="room-icon-btn" onClick={saveEditing} disabled={saving} aria-label="保存昵称">
              <IconCheck />
            </button>
            <button className="room-icon-btn" onClick={() => setEditing(false)} disabled={saving} aria-label="取消编辑">
              <IconClose />
            </button>
          </div>
        ) : (
          <div
            role="button"
            onClick={startEditing}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          >
            <h2>{profile.display_name || "玩家"}</h2>
            <IconPencil />
          </div>
        )}
        {errorMsg && <p style={{ color: "var(--amber)", fontSize: 12, marginTop: 6 }}>{errorMsg}</p>}

        <p className="mono" style={{ fontSize: 32, color: "var(--jade)", marginTop: 8 }}>{profile.rating}</p>
        <p className="muted">段位积分 · 联机对战按胜负增减,人机对战不计分</p>
      </div>

      <div className="panel" style={{ display: "flex", justifyContent: "space-around", marginBottom: 20 }}>
        <Stat label="胜" value={profile.wins} />
        <Stat label="负" value={profile.losses} />
        <Stat label="平" value={profile.draws} />
        <Stat label="胜率" value={`${winRate}%`} />
      </div>

      <div className="panel" style={{ marginBottom: 20, fontSize: 14 }}>
        {profile.username && (
          <Row label="Telegram" value={`@${profile.username}`} />
        )}
        {joinedDate && <Row label="加入时间" value={joinedDate} />}
        {profile.is_guest && <Row label="账号类型" value="访客(调试用)" />}
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

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
