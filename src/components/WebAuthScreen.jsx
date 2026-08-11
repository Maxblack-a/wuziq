import { useState } from "react";
import { registerWithPassword, loginWithPassword, loginAnonymously } from "../lib/supabase";

// 只在"网页版、且这台设备上还没有任何登录态"时才会出现。Telegram 环境
// 完全走 telegram-auth 那条路,不会渲染到这个组件;这里出现的账号一旦
// 登录成功,session 会跟 Telegram/访客账号一样存进 localStorage 自动续期,
// 之后重新打开不会再看到这个页面。
export default function WebAuthScreen({ onSuccess }) {
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);
  const passwordValid = password.length >= 6;
  const canSubmit = usernameValid && passwordValid && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const uid = mode === "login"
        ? await loginWithPassword(username, password)
        : await registerWithPassword(username, password);
      await onSuccess(uid);
    } catch (e) {
      setErrorMsg(e.message || "操作失败,请重试");
      setBusy(false);
    }
  }

  async function handleGuest() {
    setBusy(true);
    setErrorMsg("");
    try {
      const uid = await loginAnonymously("模拟玩家");
      await onSuccess(uid);
    } catch (e) {
      setErrorMsg("访客登录失败,请重试");
      setBusy(false);
    }
  }

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setErrorMsg("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "80vh", padding: "0 4px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <h2 style={{ marginBottom: 8 }}>墨局五子棋</h2>
        <p className="muted">{mode === "login" ? "登录你的账号" : "创建一个新账号"}</p>
      </div>

      <div style={{
        display: "flex", marginBottom: 20, background: "var(--wood-soft)",
        borderRadius: "var(--radius-md)", padding: 4,
      }}>
        {[["login", "登录"], ["register", "注册"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => switchMode(key)}
            style={{
              flex: 1, padding: "10px 0", border: "none", borderRadius: "var(--radius-sm)",
              background: mode === key ? "var(--surface)" : "transparent",
              color: mode === key ? "var(--fg)" : "var(--fg-muted)",
              fontWeight: mode === key ? 600 : 400,
              boxShadow: mode === key ? "var(--shadow-card)" : "none",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        autoFocus
        value={username}
        onChange={(e) => { setUsername(e.target.value); setErrorMsg(""); }}
        placeholder="用户名(3-20位字母/数字/下划线)"
        maxLength={20}
        autoCapitalize="none"
        autoCorrect="off"
        style={{
          width: "100%", padding: 16, fontSize: 16, textAlign: "center",
          background: "var(--wood-soft)", color: "var(--fg)", border: "1px solid var(--ink-line)",
          borderRadius: "var(--radius-md)", marginBottom: 10,
        }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
        placeholder="密码(至少6位)"
        maxLength={72}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        style={{
          width: "100%", padding: 16, fontSize: 16, textAlign: "center",
          background: "var(--wood-soft)", color: "var(--fg)", border: "1px solid var(--ink-line)",
          borderRadius: "var(--radius-md)", marginBottom: 8,
        }}
      />

      {errorMsg && (
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--amber)", marginBottom: 12 }}>{errorMsg}</p>
      )}

      <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit} style={{ marginBottom: 12 }}>
        {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
      </button>

      <button className="btn-ghost" disabled={busy} onClick={handleGuest}>
        以访客身份体验
      </button>
    </div>
  );
}
