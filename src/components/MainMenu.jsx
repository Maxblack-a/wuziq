import { useState, useEffect, useRef } from "react";
import RulesModal from "./RulesModal";
import { IconRules, IconRobot, IconArrowRight, IconAvatarFallback } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";

/* 临时调试面板:排查线上"色差"问题专用,不用开发者工具,截图就能看到
   浏览器实际生效(computed)的颜色值——不是源码里写的值,是浏览器最终
   算出来、真正拿去画在屏幕上的值,所以能排除"部署的是不是新文件"这类
   疑问。只有 URL 带 ?debug=1 时才显示,不影响正常用户看到的页面。
   排查完这次的问题之后可以整段删掉(包括上面这个 import 里的
   useEffect/useRef,以及下面 <DebugBadge /> 那一行)。 */
function DebugBadge({ heroRef }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const hero = heroRef.current;
      if (!hero) return;
      const heroStyle = getComputedStyle(hero);
      const shellEl = hero.closest(".app-shell-menu");
      const shellStyle = shellEl ? getComputedStyle(shellEl) : null;
      const heroRect = hero.getBoundingClientRect();
      // 在 hero 容器底边正下方 6px 取一个真实存在的元素,看那里的背景色
      const belowPoint = document.elementFromPoint(
        window.innerWidth / 2,
        Math.min(heroRect.bottom + 6, window.innerHeight - 1)
      );
      const belowStyle = belowPoint ? getComputedStyle(belowPoint) : null;

      setInfo({
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
        heroBottom: Math.round(heroRect.bottom),
        heroBg: heroStyle.backgroundImage.slice(0, 90),
        shellBg: shellStyle ? shellStyle.backgroundImage.slice(0, 90) : "n/a",
        belowTag: belowPoint ? belowPoint.className || belowPoint.tagName : "n/a",
        belowBg: belowStyle ? belowStyle.backgroundColor : "n/a",
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [heroRef]);

  if (!info) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 4,
        right: 4,
        bottom: 4,
        zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        color: "#7CFC9A",
        fontFamily: "monospace",
        fontSize: "9px",
        lineHeight: 1.5,
        padding: "6px 8px",
        borderRadius: "6px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        pointerEvents: "none",
      }}
    >
      {`viewport: ${info.w}x${info.h}  dpr:${info.dpr}\nhero.bottom: ${info.heroBottom}px\nhero-full-bleed bg: ${info.heroBg}\napp-shell-menu bg: ${info.shellBg}\nelement right below hero: ${info.belowTag}\n  -> its bg-color: ${info.belowBg}`}
    </div>
  );
}

export default function MainMenu({ onSelect, playerName, exp, avatarUrl }) {
  const [showRules, setShowRules] = useState(false);
  const level = levelForExp(exp);
  const title = titleForExp(exp ?? 0);
  // 当前阶内的进度,用于顶栏身份牌下方的小进度条
  const progressPct = Math.min(95, Math.max(8, progressPctForExp(exp)));
  const heroRef = useRef(null);
  const showDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  return (
    <div>
      {showDebug && <DebugBadge heroRef={heroRef} />}
      {/* 品牌区整体全出血(横向撑满屏幕,不受 app-shell 左右内边距限制):
          图片是真正的背景,不是一张"贴上去"的卡片——顶栏和标题文字都
          浮在这张背景之上,内部再用 hero-full-bleed-inner 把内容拉回
          和页面其他内容对齐的左右边距,这样文字/图标位置不变,只有
          背景图本身是通到屏幕两侧的。 */}
      <div className="hero-full-bleed" ref={heroRef}>
        {/* 原图是没压缩过的 2MB PNG(1024×1535),每次进首页都要重新拉这么
            大一张图,弱网/首次打开时会有明显的空白/延迟。换成体积小两个
            数量级的 WebP(~27KB,大多数 Telegram 内置浏览器和现代手机
            浏览器都支持),jpg 作为极少数不支持 webp 的老 webview 兜底,
            两者视觉观感跟原图基本无差别(整张图本身就是柔焦水墨风格,
            对轻度压缩不敏感)。width/height 写死原图像素比例,让浏览器
            在图片真正下载完之前就能预留出正确的空间,不会因为图片加载
            完成才知道高度而"跳一下"(布局抖动)。
            eager + high 优先级:这张图是首页视觉主体、一进来就看得见,
            不应该走浏览器默认的"图片按需/低优先级加载"策略——那样反而
            会等 JS、字体这些资源先加载完才轮到它,延迟感更明显。 */}
        <picture>
          <source srcSet="/hero-scene.webp" type="image/webp" />
          <img
            className="hero-scene-bg"
            src="/hero-scene.jpg"
            width="1024"
            height="1535"
            alt=""
            aria-hidden="true"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>

        {/* 图片本身在棋盘下方那段留白里,天然有一片偏亮的虚焦桌面高光——
            单独看没问题,但它上面顶着棋盘投影、下面紧贴纯黑的"开始对局"
            按钮,强对比之下这片高光会被视觉误读成一块"没对齐好的色块"。
            这里不改图片,叠一层从透明到暗的竖向渐变,把这片高光自然
            压暗、平滑过渡到按钮的墨色,变成有意为之的"聚光收束"效果,
            而不是意外露出来的一块背景色。 */}
        <div className="hero-bottom-vignette" aria-hidden="true" />

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

        {/* 在线状态:结构、配色、文案跟原来完全一样(两行、两级颜色、
            两侧装饰虚线),只是整体尺寸缩小了一圈——只做"缩小",
            不改样式。 */}
        <div className="online-status fade-in-up" style={{ animationDelay: "100ms" }}>
          <span className="online-status-line">
            <span className="online-dot-glow" />
            ONLINE
          </span>
          <span className="online-status-sub">
            {playerName ? `已连接到棋局世界 · ${playerName}` : "已连接到棋局世界"}
          </span>
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
