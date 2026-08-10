import { useState } from "react";
import { IconAvatarFallback } from "./Icons";

// 第一次进入游戏时强制走的一步:昵称已经用 Telegram 资料自动填好了,
// 但还是要玩家自己看一眼、确认(或者改成自己想要的)再点确认——不能
// 什么都不问就直接拿 Telegram 名字当游戏昵称用。确认之后可以随时去
// "我的"页面改。没有返回键:这是新用户必须迈过去的第一步,不接
// Telegram 物理返回键,也不该有别的出口。
export default function NicknameSetupScreen({ initialName, avatarUrl, onConfirm }) {
  const [name, setName] = useState(initialName || "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 20;

  async function handleConfirm() {
    if (!valid || saving) return;
    setSaving(true);
    setErrorMsg("");
    try {
      await onConfirm(trimmed);
    } catch (e) {
      setErrorMsg("保存失败,请重试");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "80vh", padding: "0 4px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", marginBottom: 16 }} />
        ) : (
          <div style={{
            width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--wood-soft)", color: "var(--fg-muted)",
          }}>
            <IconAvatarFallback size={32} />
          </div>
        )}
        <h2 style={{ marginBottom: 8 }}>欢迎</h2>
        <p className="muted">给自己起个昵称,棋友们会看到这个名字</p>
      </div>

      <input
        autoFocus
        value={name}
        onChange={(e) => { setName(e.target.value); setErrorMsg(""); }}
        placeholder="输入昵称"
        maxLength={20}
        style={{
          width: "100%", padding: 16, fontSize: 18, textAlign: "center",
          background: "var(--ink)", color: "var(--fg)", border: "1px solid var(--ink-line)",
          borderRadius: "var(--radius-md)", marginBottom: 8,
        }}
      />
      <p className="muted" style={{ textAlign: "center", fontSize: 12, marginBottom: errorMsg ? 4 : 20 }}>
        1-20 个字符,之后可以在"我的"页面随时修改
      </p>
      {errorMsg && (
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--amber)", marginBottom: 20 }}>{errorMsg}</p>
      )}

      <button className="btn-primary" disabled={!valid || saving} onClick={handleConfirm}>
        {saving ? "保存中…" : "确认"}
      </button>
    </div>
  );
}
