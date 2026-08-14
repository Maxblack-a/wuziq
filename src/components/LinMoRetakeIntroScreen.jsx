import { useState } from "react";
import { retakeGreetingLine, RETAKE_ACCEPT_LABEL, RETAKE_CANCEL_LABEL } from "../lib/linmoDialogue";

// 跟 LinMoIntroScreen 共用同一张背景图和同一套气泡/按钮样式,但流程简化成
// 一步——不问昵称(已经认识了),打个招呼直接问要不要再测一次。
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

      <div className="linmo-scene-content">
        <div className="linmo-eyebrow">墨云棋馆</div>
        <div className="linmo-bubble">
          <p className="linmo-bubble-line">{greeting}</p>
        </div>
        <div className="linmo-actions-row">
          <button className="btn-ghost" onClick={onCancel}>{RETAKE_CANCEL_LABEL}</button>
          <button className="btn-primary" onClick={onStart}>{RETAKE_ACCEPT_LABEL}</button>
        </div>
      </div>
    </div>
  );
}
