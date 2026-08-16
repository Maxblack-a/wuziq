import { useState } from "react";
import { retakeGreetingLine, RETAKE_ACCEPT_LABEL, RETAKE_CANCEL_LABEL } from "../lib/linmoDialogue";
import { IconArrowRight, IconAvatarFallback, IconFriends, IconTrophy, IconProfile, IconSparkle } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";

// 跟 LinMoIntroScreen 共用同一张背景图和同一套顶栏/左栏排版,只是流程
// 简化成一步——不问昵称(已经认识了),打个招呼直接问要不要再测一次。
// useState 只是为了让 greeting 只在组件挂载时随机选一次,不随每次渲染
// 重新抽签(不然按钮的 hover/点击态重渲染时台词会跳来跳去)。
export default function LinMoRetakeIntroScreen({ displayName, exp, avatarUrl, onStart, onCancel }) {
  const [greeting] = useState(() => retakeGreetingLine(displayName));

  const level = levelForExp(exp);
  const title = titleForExp(exp ?? 0);
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(exp)));

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

        <div className="linmo-bubble">
          <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
          <p className="linmo-bubble-line">{greeting}</p>
        </div>
        <div className="linmo-actions-row">
          <button className="btn-ghost" onClick={onCancel}>{RETAKE_CANCEL_LABEL}</button>
          <button className="linmo-cta" onClick={onStart}>
            <span>{RETAKE_ACCEPT_LABEL}</span>
            <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
