import { useState } from "react";
import { retakeGreetingLine, RETAKE_ACCEPT_LABEL, RETAKE_CANCEL_LABEL } from "../lib/linmoDialogue";
import { IconArrowRight, IconSparkle } from "./Icons";

// 跟 LinMoIntroScreen 共用同一张背景图和同一套左栏排版(顶栏已经拿掉,
// 见 linmo.css 顶部注释),只是流程简化成一步——不问昵称(已经认识
// 了),打个招呼直接问要不要再测一次。
// useState 只是为了让 greeting 只在组件挂载时随机选一次,不随每次渲染
// 重新抽签(不然按钮的 hover/点击态重渲染时台词会跳来跳去)。
export default function LinMoRetakeIntroScreen({ displayName, onStart, onCancel }) {
  const [greeting] = useState(() => retakeGreetingLine(displayName));

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

      <div className="linmo-scene-column">
        <div className="linmo-brand-block">
          <div className="linmo-brand-name">WUZIQIX</div>
          <div className="linmo-brand-title-row">
            <h1>五子棋</h1>
            <span className="linmo-brand-seal">规</span>
          </div>
          <p className="linmo-brand-slogan">黑白之间 · 一念胜负</p>
        </div>

        <div className="linmo-bubble linmo-invite-bubble">
          <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
          <div className="linmo-invite-bubble-name">
            林墨<span className="linmo-invite-bubble-name-icon"><IconSparkle size={11} /></span>
          </div>
          <div className="linmo-invite-bubble-divider" />
          <p className="linmo-bubble-line linmo-invite-bubble-line">{greeting}</p>
          <div className="linmo-invite-bubble-end-divider"><span className="linmo-invite-bubble-end-divider-dot" /></div>
        </div>
        <div className="linmo-actions-row linmo-invite-actions-row">
          <button className="linmo-cta linmo-invite-cta" onClick={onStart}>
            <span>{RETAKE_ACCEPT_LABEL}</span>
            <IconArrowRight size={16} />
          </button>
          <button className="btn-ghost linmo-invite-skip" onClick={onCancel}>{RETAKE_CANCEL_LABEL}</button>
        </div>
      </div>
    </div>
  );
}
