import { useState } from "react";
import {
  GREETING_LINES, NAME_HINT, inviteLine,
  INVITE_ACCEPT_LABEL, INVITE_SKIP_LABEL,
} from "../lib/linmoDialogue";
import { IconArrowRight, IconAvatarFallback, IconFriends, IconTrophy, IconProfile, IconPencil, IconSparkle } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";

// 新用户第一次进来强制走的一步(取代原来的 NicknameSetupScreen):
// 不是一个孤零零的表单,而是"认识林墨"这场戏——图片是真正的背景。
// 排版严格按参考设计图来:顶栏(身份牌 + 好友/排行榜/我的)横跨整个
// 宽度贴顶;真正的内容是一条贴左对齐的窄列(压在背景照片天然偏亮的
// 那一侧),不是居中、也不是堆在底部。见 linmo.css 顶部注释。
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
// 顶栏右侧的 好友/排行榜/我的 这几个入口,这一版按参考图原样加上了——
// 之前顾虑过"这时候用户昵称还没确认,点进去可能没意义",所以先做成
// 纯展示、不绑定点击跳转,不强行接一个还没走完的流程。如果需要它们
// 真的可以点,告诉我要跳到哪里。
export default function LinMoIntroScreen({
  initialName, initialStep = "name", exp, avatarUrl,
  onNameConfirm, onStartTest, onSkipTest,
}) {
  const [step, setStep] = useState(initialStep); // 'name' | 'invite'
  const [name, setName] = useState(initialName || "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmedName, setConfirmedName] = useState(initialStep === "invite" ? (initialName || "") : "");

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 20;

  const level = levelForExp(exp);
  const title = titleForExp(exp ?? 0);
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(exp)));

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

      <div className="linmo-scene-topbar">
        <div className="identity-badge">
          <div className="identity-avatar">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <IconAvatarFallback size={20} />}
          </div>
          <div className="identity-meta">
            <span className="identity-level">LV.{level} {title}</span>
            <span className="identity-progress-track">
              <span className="identity-progress-fill" style={{ width: `${progressPct}%` }} />
            </span>
            <span className="identity-exp-text">{expProgressText(exp)}</span>
          </div>
        </div>
        <div className="linmo-nav">
          <div className="linmo-nav-item"><IconFriends size={18} /><span>好友</span></div>
          <div className="linmo-nav-item"><IconTrophy size={18} /><span>排行榜</span></div>
          <div className="linmo-nav-item"><IconProfile size={18} /><span>我的</span></div>
        </div>
      </div>

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
            <div className="linmo-bubble">
              <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
              <p className="linmo-bubble-line">{inviteLine(confirmedName)}</p>
            </div>
            <div className="linmo-actions-row">
              <button className="btn-ghost" onClick={onSkipTest}>{INVITE_SKIP_LABEL}</button>
              <button className="linmo-cta" onClick={onStartTest}>
                <span>{INVITE_ACCEPT_LABEL}</span>
                <IconArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
