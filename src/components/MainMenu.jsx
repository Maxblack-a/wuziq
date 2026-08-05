import { useState } from "react";
import RulesModal from "./RulesModal";
import HeroBoard from "./HeroBoard";
import { IconFriends, IconTrophy, IconProfile, IconRobot, IconLink, IconArrowRight, IconSeal, IconAvatarFallback } from "./Icons";

// 段位头衔:纯展示层的分档,不影响任何积分/匹配逻辑,只是把 rating
// 翻译成一个更有"棋院感"的称呼,呼应参考图里"LV.12 棋士"的身份牌感。
function titleForRating(rating) {
  if (rating >= 1800) return "棋圣";
  if (rating >= 1400) return "高手";
  if (rating >= 1000) return "棋士";
  return "棋童";
}

// 等级同样是从已有的 rating 字段派生出来的展示值,不新增任何数据库字段。
function levelForRating(rating) {
  return Math.max(1, Math.floor(((rating ?? 1200) - 800) / 40));
}

export default function MainMenu({ onSelect, playerName, rating, avatarUrl }) {
  const [showRules, setShowRules] = useState(false);
  const level = levelForRating(rating);
  const title = titleForRating(rating ?? 1200);
  const progressPct = Math.min(95, Math.max(8, ((rating ?? 1200) - 800) % 40 * 2.5));

  return (
    <div>
      {/* 顶栏:左边身份牌(头像+等级),右边三个轻量图标入口。"规则"不再
          单独占一个导航位,挪去品牌区的印章上触发,顶栏严格保持三图标 */}
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
          </div>
        </div>

        <nav className="top-nav-light">
          <button className="nav-icon-btn" onClick={() => onSelect("friends")}>
            <IconFriends />
            <span>好友</span>
          </button>
          <button className="nav-icon-btn" onClick={() => onSelect("leaderboard")}>
            <IconTrophy />
            <span>排行榜</span>
          </button>
          <button className="nav-icon-btn" onClick={() => onSelect("profile")}>
            <IconProfile />
            <span>我的</span>
          </button>
        </nav>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* 品牌区 */}
      <div className="brand-hero fade-in-up" style={{ animationDelay: "40ms" }}>
        <div className="brand-name">WUZIGIX</div>
        <div className="brand-title-row">
          <h1>五子棋</h1>
          <button className="brand-seal" onClick={() => setShowRules(true)} aria-label="玩法规则">
            <IconSeal />
          </button>
        </div>
        <p className="brand-slogan">黑白之间 · 一念胜负</p>
      </div>

      {/* 品牌核心视觉:静态棋盘展示。入场动效已经在 HeroBoard 组件内部
          精心设计过了(棋盒淡入定住 + 棋子逐颗落下),这里不再额外包一层
          fade-in-up,避免两层动效叠在一起显得乱 */}
      <HeroBoard />

      {/* 在线状态行:菜单页只有在 App.jsx 里 boot() 成功、拿到 myId 之后
          才会渲染,所以到这一步一定已经连上了——这里是纯展示,不额外
          接状态管理 */}
      <div className="online-status fade-in-up" style={{ animationDelay: "100ms" }}>
        <span className="online-status-line">
          <span className="online-dot-glow" />
          ONLINE
        </span>
        <span className="online-status-sub">
          {playerName ? `已连接到棋局世界 · ${playerName}` : "已连接到棋局世界"}
        </span>
      </div>

      {/* 主 CTA:开始对局(对应原有的匹配对战入口) */}
      <button className="cta-primary fade-in-up" style={{ animationDelay: "140ms" }} onClick={() => onSelect("matchmaking")}>
        <span className="cta-primary-text">
          <span className="cta-primary-title">开始对局</span>
          <span className="cta-primary-sub">START MATCH</span>
        </span>
        <span className="cta-primary-arrow"><IconArrowRight /></span>
      </button>

      {/* 次级入口:人机挑战 + 邀请好友,并排、视觉分量低于主CTA */}
      <div className="secondary-row fade-in-up" style={{ animationDelay: "200ms" }}>
        <button className="secondary-card" onClick={() => onSelect("pve")}>
          <div className="secondary-card-icon"><IconRobot /></div>
          <div className="secondary-card-title">人机挑战</div>
          <div className="secondary-card-sub">AI MATCH</div>
        </button>
        <button className="secondary-card" onClick={() => onSelect("invite")}>
          <div className="secondary-card-icon"><IconLink /></div>
          <div className="secondary-card-title">邀请好友</div>
          <div className="secondary-card-sub">PRIVATE GAME</div>
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
