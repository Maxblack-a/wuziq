import { useState } from "react";
import RulesModal from "./RulesModal";
import StatBadge from "./StatBadge";
import { IconRules, IconRobot, IconCalendarStar, IconArrowRight, IconAvatarFallback, IconBolt, IconGem } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";
import { getDisplayStamina } from "../game/dailyTrialEngine";

export default function MainMenu({
  onSelect, playerName, exp, avatarUrl,
  stamina, staminaDate, diamonds,
  staminaFrom, diamondsFrom,
}) {
  const [showRules, setShowRules] = useState(false);
  const level = levelForExp(exp);
  const title = titleForExp(exp ?? 0);
  // 当前阶内的进度,用于顶栏身份牌下方的小进度条
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(exp)));
  const displayStamina = getDisplayStamina(stamina, staminaDate);

  return (
    <>
      {/* 图片本身就是整个首页的背景,不再是"顶部一块 hero banner + 下面
          接一层 CSS 渐变背景"这种拼接结构——不需要额外的 CSS 背景色/
          渐变去填充图片之外的区域,因为压根不存在"图片之外的区域":
          这张 <img> 直接铺满 .app-shell-menu 的整个可视范围(宽和高
          都是 100%),不管屏幕比例怎么变,object-fit: cover 都会让图片
          自己适应屏幕去裁剪填满,而不是靠 CSS 颜色去凑差值。
          必须放在 .menu-screen-flex 外面、作为 app-shell-menu 的
          直接子元素:这样它才能相对 app-shell-menu 的整个内边距盒
          (包括左右 16px 内边距那一圈)铺满,不会被内容区自己的内边距
          限制住宽度——具体原理见 menu.css 里 .page-bg-image 的注释。
          原图是没压缩过的 PNG(793×1981),换成体积小的 WebP(大多数
          Telegram 内置浏览器和现代手机浏览器都支持),jpg 作为极少数
          不支持 webp 的老 webview 兜底。eager + high 优先级:这张图
          一进首页就看得见,不走浏览器默认的"按需/低优先级加载"。 */}
      <picture>
        <source srcSet="/hero-scene-v2.webp" type="image/webp" />
        <img
          className="page-bg-image"
          src="/hero-scene-v2.jpg"
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </picture>

      {/* 顶栏、品牌标题用的是深色文字,假设自己叠在照片偏亮的区域
          (照片顶部本来就是亮墙面/窗户)——这层遮罩只压暗底部"执黑
          驭白·棋道无尽"这行标语真正需要的区域,不会影响顶部的深色
          文字对比度。"在线状态"那行浅色文字自己已经带了一个独立的
          深色背景块,也不依赖这层遮罩。具体每个区域为什么这样处理,
          见 menu.css 里 .page-bg-scrim 的完整注释。 */}
      <div className="page-bg-scrim" aria-hidden="true" />

      <div className="menu-screen-flex">
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
            <StatBadge className="stat-badge-energy" icon={<IconBolt size={13} />} value={displayStamina} fromValue={staminaFrom} />
            <StatBadge icon={<IconGem size={13} />} value={diamonds ?? 0} fromValue={diamondsFrom} />
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

        {/* 在线状态:结构、配色、文案跟原来完全一样(两行、两级颜色、
            两侧装饰虚线)。它要落在棋盘下方(不能压在棋盘上),但又不是
            靠 position:absolute 钉一个百分比——那样在"整张图片就是全屏
            背景"这个新结构下,数值需要重新推导,具体算法和数值见
            menu.css 里 .online-status 的 margin-top 注释。 */}
        <div className="online-status fade-in-up" style={{ animationDelay: "100ms" }}>
          <span className="online-status-line">
            <span className="online-dot-glow" />
            ONLINE
          </span>
          <span className="online-status-sub">
            {playerName ? `已连接到棋局世界 · ${playerName}` : "已连接到棋局世界"}
          </span>
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

        {/* 次级入口:人机挑战 + 每日试炼,并排展示。"邀请好友"已经并入
            上面的主 CTA 流程,这里不再重复放一个入口 */}
        <div className="secondary-row fade-in-up" style={{ animationDelay: "200ms" }}>
          <button className="secondary-card" onClick={() => onSelect("pve")}>
            <div className="secondary-card-icon"><IconRobot /></div>
            <div className="secondary-card-title">人机挑战</div>
            <div className="secondary-card-sub">AI MATCH</div>
          </button>
          <button className="secondary-card" onClick={() => onSelect("daily")}>
            <div className="secondary-card-icon"><IconCalendarStar /></div>
            <div className="secondary-card-title">每日试炼</div>
            <div className="secondary-card-sub">DAILY QUEST</div>
          </button>
        </div>

        {/* 底部标语,两侧配细线,呼应参考图收尾的"棋院牌匾感" */}
        <div className="bottom-tagline fade-in-up" style={{ animationDelay: "240ms" }}>
          <span className="tagline-line" />
          <span>执黑驭白 · 棋道无尽</span>
          <span className="tagline-line" />
        </div>
      </div>
    </>
  );
}
