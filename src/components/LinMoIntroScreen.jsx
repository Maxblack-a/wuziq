import { useState } from "react";
import {
  GREETING_LINES, NAME_PROMPT_LINE, NAME_HINT, inviteLine,
  INVITE_ACCEPT_LABEL, INVITE_SKIP_LABEL,
} from "../lib/linmoDialogue";

// 新用户第一次进来强制走的一步(取代原来的 NicknameSetupScreen):
// 不是一个孤零零的表单,而是"认识林墨"这场戏——图片是真正的背景,
// 对话框和输入框浮在上面。第一步问名字,确认之后(onNameConfirm 把
// 名字写库)停在同一个场景里,换一句台词邀请棋力测试;棋力测试本身
// 可以跳过("改天吧"),但见面这一步跟原来的昵称确认一样,没有出口。
//
// initialStep='invite':网页版用户名密码注册的账号,注册那一步已经
// 手动填过名字了,不需要再问一遍——直接从"邀请测试"这一步开始,
// initialName 这时候传进来的就是注册时填的用户名,直接当"已确认的
// 名字"用。
export default function LinMoIntroScreen({ initialName, initialStep = "name", onNameConfirm, onStartTest, onSkipTest }) {
  const [step, setStep] = useState(initialStep); // 'name' | 'invite'
  const [name, setName] = useState(initialName || "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmedName, setConfirmedName] = useState(initialStep === "invite" ? (initialName || "") : "");

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 20;

  async function handleConfirmName() {
    if (!valid || saving) return;
    setSaving(true);
    setErrorMsg("");
    try {
      await onNameConfirm(trimmed);
      setConfirmedName(trimmed);
      setStep("invite");
    } catch (e) {
      setErrorMsg("保存失败,请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="linmo-scene">
      <picture>
        <source srcSet="/linmo-scene.webp" type="image/webp" />
        <img
          className="linmo-scene-bg"
          src="/linmo-scene.jpg"
          width="941"
          height="1672"
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </picture>

      <div className="linmo-scene-content">
        <div className="linmo-eyebrow">墨云棋馆</div>

        {step === "name" ? (
          <>
            <div className="linmo-bubble">
              {GREETING_LINES.map((line) => (
                <p key={line} className="linmo-bubble-line">{line}</p>
              ))}
              <p className="linmo-bubble-line">
                你好,我叫<span className="linmo-name-highlight">林墨</span>。你叫什么名字啊?
              </p>
            </div>

            <div className="linmo-input-row">
              <span className="linmo-input-label">你的名字</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); setErrorMsg(""); }}
                placeholder="输入昵称"
                maxLength={20}
                className="linmo-input"
              />
            </div>
            <p className="linmo-hint">{NAME_HINT} · 之后可以在"我的"页面随时修改</p>
            {errorMsg && <p className="linmo-error">{errorMsg}</p>}

            <button className="btn-primary" disabled={!valid || saving} onClick={handleConfirmName}>
              {saving ? "保存中…" : "继续"}
            </button>
          </>
        ) : (
          <>
            <div className="linmo-bubble">
              <p className="linmo-bubble-line">{inviteLine(confirmedName)}</p>
            </div>
            <div className="linmo-actions-row">
              <button className="btn-ghost" onClick={onSkipTest}>{INVITE_SKIP_LABEL}</button>
              <button className="btn-primary" onClick={onStartTest}>{INVITE_ACCEPT_LABEL}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
