import { useEffect, useRef, useState } from "react";
import { supabase, uploadAvatar } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import {
  IconPencil, IconCheck, IconClose, IconChevronLeft, IconChevronRight,
  IconCamera, IconAvatarFallback, IconFriends, IconTrophy, IconRadar,
} from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";
import { TYPE_DEFS } from "../lib/skillProfile";

// "我的"页面:改成一个轻量的个人信息卡(头像/昵称/经验值)+ 两个可点击
// 跳详情的入口(好友列表、战绩),不再把好友列表、完整对局记录都直接
// 摊在这一页里——那些内容分别挪去 FriendsScreen(好友已经从顶栏收起,
// 并入这里作为入口)和新拆出来的 MatchHistoryScreen(战绩详情+胜率)。
export default function ProfileScreen({ myId, onExit, onNavigate }) {
  useTelegramBackButton(onExit);
  const [profile, setProfile] = useState(null);
  const [friendCount, setFriendCount] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", myId).single()
      .then(({ data }) => setProfile(data));

    // 好友数量只是给入口卡片当个提示文案,用 head:true 只要 count 不要
    // 把整张好友列表都拉下来
    supabase.from("friendships").select("friend_id", { count: "exact", head: true }).eq("user_id", myId)
      .then(({ count }) => setFriendCount(count ?? 0));
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

  // 选完图之后:裁成正方形、转 webp、传到 Storage,再把新地址写回
  // profiles.avatar_url——全部封装在 uploadAvatar 里,这里只管状态展示。
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 清空 value,不然连续两次选同一张图第二次不会触发 onChange
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError("");
    try {
      const url = await uploadAvatar(myId, file);
      setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
    } catch (err) {
      console.error("头像上传失败", err);
      setAvatarError("头像上传失败,请重试");
    } finally {
      setAvatarUploading(false);
    }
  }

  if (!profile) return <div style={{ textAlign: "center", padding: 60 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>;

  const level = levelForExp(profile.exp);
  const title = titleForExp(profile.exp ?? 0);
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(profile.exp)));
  const joinedDate = profile.created_at ? new Date(profile.created_at).toLocaleDateString() : null;

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

      <div className="profile-head">
        <div className="profile-avatar-wrap" role="button" onClick={() => fileInputRef.current?.click()} aria-label="更换头像">
          <div className="profile-avatar">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <IconAvatarFallback size={34} />}
            {avatarUploading && (
              <div className="profile-avatar-loading"><div className="spinner" /></div>
            )}
          </div>
          <span className="profile-avatar-cam"><IconCamera /></span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          style={{ display: "none" }}
        />
        {avatarError && <p style={{ color: "var(--amber)", fontSize: 12, marginTop: 6 }}>{avatarError}</p>}

        {editing ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => { setDraftName(e.target.value); setErrorMsg(""); }}
              maxLength={20}
              disabled={saving}
              style={{
                fontSize: 18, fontWeight: 700, textAlign: "center", padding: "6px 10px",
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
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 12 }}
          >
            <h2>{profile.display_name || "玩家"}</h2>
            <IconPencil />
          </div>
        )}
        {errorMsg && <p style={{ color: "var(--amber)", fontSize: 12, marginTop: 6 }}>{errorMsg}</p>}

        {/* 经验值:跟首页身份牌同一套展示方式(等级+称号 / 进度条 / 阶内
            "已攒·总共"文字),不再用一个占大半屏的巨大数字面板 */}
        <div className="profile-exp-row">
          <span className="identity-level">LV.{level} {title}</span>
          <span className="identity-progress-track" style={{ width: 120 }}>
            <span className="identity-progress-fill" style={{ width: `${progressPct}%` }} />
          </span>
          <span className="identity-exp-text">{expProgressText(profile.exp)}</span>
        </div>
      </div>

      <button className="mode-card" style={{ marginTop: 20 }} onClick={() => onNavigate?.("friends")}>
        <div className="icon"><IconFriends /></div>
        <div style={{ flex: 1 }}>
          <div className="title">好友</div>
          <div className="desc">{friendCount === null ? "查看好友列表" : `${friendCount} 位好友 · 点击查看详情`}</div>
        </div>
        <div className="muted" style={{ display: "flex" }}><IconChevronRight /></div>
      </button>

      <button className="mode-card" style={{ marginTop: 10 }} onClick={() => onNavigate?.("history")}>
        <div className="icon"><IconTrophy /></div>
        <div style={{ flex: 1 }}>
          <div className="title">战绩</div>
          <div className="desc">{profile.wins}胜 {profile.losses}负 {profile.draws}平 · 点击查看详情</div>
        </div>
        <div className="muted" style={{ display: "flex" }}><IconChevronRight /></div>
      </button>

      {/* 棋力测试(林墨)入口:任何状态都显示——没测过/跳过了引导去测,
          测过了显示当次类型,点进去还能再测一次 */}
      <button className="mode-card" style={{ marginTop: 10 }} onClick={() => onNavigate?.("skilltest_view")}>
        <div className="icon"><IconRadar /></div>
        <div style={{ flex: 1 }}>
          <div className="title">棋风</div>
          <div className="desc">
            {profile.skill_test_status === "completed"
              ? `${(TYPE_DEFS[profile.skill_test_type] || TYPE_DEFS.balanced).name} · 林墨的棋力测试结果`
              : "还没测过 · 点击去测一下"}
          </div>
        </div>
        <div className="muted" style={{ display: "flex" }}><IconChevronRight /></div>
      </button>

      <div className="panel" style={{ marginTop: 20, marginBottom: 20, fontSize: 14 }}>
        {profile.username && (
          <Row label="Telegram" value={`@${profile.username}`} />
        )}
        {joinedDate && <Row label="加入时间" value={joinedDate} />}
        {profile.is_guest && <Row label="账号类型" value="访客(调试用)" />}
      </div>
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
