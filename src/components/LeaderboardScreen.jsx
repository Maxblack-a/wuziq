import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconChevronLeft } from "./Icons";

export default function LeaderboardScreen({ myId, onExit }) {
  useTelegramBackButton(onExit);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name, exp, wins, losses, draws")
      .eq("is_guest", false)
      .order("exp", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows(data || []));
  }, []);

  return (
    <div>
      {/* Telegram 自带的返回键已经接了同一个 onExit(见上面
          useTelegramBackButton),UI 上不用再重复画一份;但普通浏览器里
          没有 Telegram 原生返回键,这里必须补一个,否则用户没法退出。 */}
      {!isInTelegram && (
        <div className="room-topbar" style={{ marginBottom: 4 }}>
          <button className="room-icon-btn" onClick={onExit} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
      )}
      <div className="menu-header"><h2>排行榜</h2></div>

      {rows.map((r, i) => (
        <div
          key={r.id}
          className="mode-card"
          style={{ marginBottom: 8, borderColor: r.id === myId ? "var(--jade)" : undefined }}
        >
          <div className="mono" style={{ width: 28, textAlign: "center", color: i < 3 ? "var(--amber)" : "var(--fg-muted)" }}>
            {i + 1}
          </div>
          <div style={{ flex: 1 }}>
            <div className="title">{r.display_name || "玩家"}</div>
            <div className="desc">{r.wins}胜 {r.losses}负 {r.draws}平</div>
          </div>
          <div className="mono" style={{ fontSize: 18, color: "var(--jade)" }}>{r.exp}</div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted" style={{ textAlign: "center" }}>暂无数据</p>}
    </div>
  );
}
