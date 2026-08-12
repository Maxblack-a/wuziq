import { useState } from "react";
import RulesModal from "./RulesModal";
import { IconRules, IconRobot, IconArrowRight, IconAvatarFallback } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";

export default function MainMenu({ onSelect, playerName, exp, avatarUrl }) {
  const [showRules, setShowRules] = useState(false);
  const level = levelForExp(exp);
  const title = titleForExp(exp ?? 0);
  // 当前阶内的进度,用于顶栏身份牌下方的小进度条
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(exp)));

  return (
    <div>
      {/* 品牌区整体全出血(横向撑满屏幕,不受 app-shell 左右内边距限制):
          图片是真正的背景,不是一张"贴上去"的卡片——顶栏和标题文字都
          浮在这张背景之上,内部再用 hero-full-bleed-inner 把内容拉回
          和页面其他内容对齐的左右边距,这样文字/图标位置不变,只有
          背景图本身是通到屏幕两侧的。 */}
      <div className="hero-full-bleed">
        <img className="hero-scene-bg" src="/hero-scene.png" alt="" aria-hidden="true" />

        <div className="hero-full-bleed-inner">
          {/* 顶栏:左边身份牌(头像+等级+经验值文字),右边只留"规则"
              一个入口——好友/排行榜/我的都已经从顶栏收起,"我的"点左边
              身份牌就能进,好友已并入"我的"页面,排行榜暂时隐藏。
              规则原本挂在品牌区的印章上,现在挪回顶栏,占住"我的"原来
              的位置,风格也换成跟其它导航项一致的图标+文字。 */}
          <div className="top-bar fade-in-up" style={{ animationDelay: "0ms" }}>
            <div className="identity-badge" onClick={() => onSelect("profile")}>
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

            <nav className="top-nav-light">
              <button className="nav-icon-btn" onClick={() => setShowRules(true)}>
                <IconRules />
                <span>规则</span>
              </button>
            </nav>
          </div>

          <div className="brand-hero fade-in-up" style={{ animationDelay: "40ms" }}>
            <div className="brand-name">WUZIGIX</div>
            <div className="brand-title-row">
              <h1>五子棋</h1>
            </div>
            <p className="brand-slogan">黑白之间 · 一念胜负</p>
          </div>
        </div>

        {/* 在线状态:图片下半截棋盘投影下方本来就是留白区,文字直接写
            在图片这块留白上(不是另起一段挤在图片外面)。上一版是两行
            大块文字,现在缩成一枚小胶囊,占用的留白高度更小、更克制。 */}
        <div className="online-status-compact fade-in-up" style={{ animationDelay: "100ms" }}>
          <span className="online-dot-glow-sm" />
          <span>ONLINE{playerName ? ` · ${playerName}` : ""}</span>
        </div>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* 主 CTA:开始对局。之前这里直接进随机匹配、"邀请好友"是另一个单独
          入口——现在合并成一个:点进去先进"对局房间",在那边再选"匹配"
          还是"邀请好友",两条路都从同一个房间出发 */}
      <button className="cta-primary fade-in-up" style={{ animationDelay: "140ms" }} onClick={() => onSelect("room")}>
        <span className="cta-primary-text">
          <span className="cta-primary-title">开始对局</span>
          <span className="cta-primary-sub">START MATCH</span>
        </span>
        <span className="cta-primary-arrow"><IconArrowRight /></span>
      </button>

      {/* 次级入口:人机挑战。"邀请好友"已经并入上面的主 CTA 流程,
          这里不再重复放一个入口 */}
      <div className="secondary-row fade-in-up" style={{ animationDelay: "200ms" }}>
        <button className="secondary-card" onClick={() => onSelect("pve")}>
          <div className="secondary-card-icon"><IconRobot /></div>
          <div className="secondary-card-title">人机挑战</div>
          <div className="secondary-card-sub">AI MATCH</div>
        </button>
      </div>

      {/* 底部标语,两侧配细线,呼应参考图收尾的"棋院牌匾感" */}
      <div className="bottom-tagline fade-in-up" style={{ animationDelay: "240ms" }}>
        <span className="tagline-line" />
        <span>执黑驭白 · 棋道无尽</span>
        <span className="tagline-line" />
      </div>
    </div>
  );
}
