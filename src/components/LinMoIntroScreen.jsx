import { useState } from "react";
import {
  GREETING_LINES, NAME_HINT, inviteLine,
  INVITE_ACCEPT_LABEL, INVITE_SKIP_LABEL,
} from "../lib/linmoDialogue";
import { IconArrowRight, IconPencil, IconSparkle } from "./Icons";

// 新用户第一次进来强制走的一步(取代原来的 NicknameSetupScreen):
// 不是一个孤零零的表单,而是"认识林墨"这场戏——图片是真正的背景。
// 内容是一条贴左对齐的窄列(压在背景照片天然偏亮的那一侧),从接近
// 顶部的地方开始,不居中、也不堆在底部。见 linmo.css 顶部注释。
//
// 第一步问名字,确认之后(onNameConfirm 把名字写库)停在同一个场景里,
// 换一句台词邀请棋力测试;棋力测试本身可以跳过("改天吧"),但见面
// 这一步跟原来的昵称确认一样,没有出口。
//
// initialStep='invite':网页版用户名密码注册的账号,注册那一步已经
// 手动填过名字了,不需要再问一遍——直接从"邀请测试"这一步开始,
// initialName 这时候传进来的就是注册时填的用户名,直接当"已确认的
// 名字"用。
//
// 顶栏(身份牌 + 好友/排行榜/我的)已经拿掉了——见 linmo.css 顶部注释:
// 一是这个页面出现的时候用户昵称都还没确认,这些入口本来就没有实际
// 内容;二是矮屏幕/矮窗口下,省掉这部分高度能明显减少"要往下滑才能
// 看到按钮"的情况。
export default function LinMoIntroScreen({
  initialName, initialStep = "name",
  onNameConfirm, onStartTest, onSkipTest,
}) {
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

      <div className="linmo-scene-column">
        <div className="linmo-brand-block">
          <div className="linmo-brand-name">WUZIQIX</div>
          <div className="linmo-brand-title-row">
            <h1>五子棋</h1>
            <span className="linmo-brand-seal">规</span>
          </div>
          <p className="linmo-brand-slogan">黑白之间 · 一念胜负</p>
        </div>

        {step === "name" ? (
          <>
            <div className="linmo-bubble">
              <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
              {GREETING_LINES.map((line) => (
                <p key={line} className="linmo-bubble-line">{line}</p>
              ))}
            </div>

            <p className="linmo-plain-line">
              你好,我叫<span className="linmo-name-highlight">林墨</span>。
              <br />你叫什么名字啊?
            </p>

            <div className="linmo-divider"><span className="linmo-divider-dot" /></div>

            <div className="linmo-input-row">
              <span className="linmo-input-label"><span className="linmo-diamond" style={{ marginLeft: 0 }} />你的名字</span>
              <div className="linmo-input-wrap">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => { setName(e.target.value); setErrorMsg(""); }}
                  placeholder="输入昵称"
                  maxLength={20}
                  className="linmo-input"
                />
                <span className="linmo-input-icon"><IconPencil size={18} /></span>
              </div>
            </div>
            <p className="linmo-hint">
              <span className="linmo-hint-dot" />{NAME_HINT}<span className="linmo-hint-dot" />
            </p>
            {errorMsg && <p className="linmo-error">{errorMsg}</p>}

            <button className="linmo-cta" disabled={!valid || saving} onClick={handleConfirmName}>
              <span>{saving ? "保存中…" : "继续"}</span>
              {!saving && <IconArrowRight size={16} />}
            </button>
          </>
        ) : (
          <>
            <div className="linmo-bubble linmo-invite-bubble">
              <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
              <div className="linmo-invite-bubble-name">
                林墨<span className="linmo-invite-bubble-name-icon"><IconSparkle size={11} /></span>
              </div>
              <div className="linmo-invite-bubble-divider" />
              <p className="linmo-bubble-line linmo-invite-bubble-line">{inviteLine(confirmedName)}</p>
              <div className="linmo-invite-bubble-end-divider"><span className="linmo-invite-bubble-end-divider-dot" /></div>
            </div>
            <div className="linmo-actions-row linmo-invite-actions-row">
              <button className="linmo-cta linmo-invite-cta" onClick={onStartTest}>
                <span>{INVITE_ACCEPT_LABEL}</span>
                <IconArrowRight size={16} />
              </button>
              <button className="btn-ghost linmo-invite-skip" onClick={onSkipTest}>{INVITE_SKIP_LABEL}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
