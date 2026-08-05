// 统一风格的线性图标,不用 emoji,不引入图标库依赖。
// 全部用 currentColor,方便在导航默认态/激活态之间切换颜色。

export function IconFriends({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8" r="3" />
      <circle cx="16" cy="9.5" r="2.4" />
      <path d="M3.5 19c0-3 2.2-5 5-5s5 2 5 5" />
      <path d="M13.5 14.2c2.2.2 3.8 1.9 3.8 4.3" />
    </svg>
  );
}

export function IconTrophy({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4.5A2.5 2.5 0 0 0 6 9.5" />
      <path d="M17 5h2.5A2.5 2.5 0 0 1 18 9.5" />
      <path d="M12 13v3" />
      <path d="M8.5 20h7" />
      <path d="M10 16.5h4l.6 3.5H9.4l.6-3.5z" />
    </svg>
  );
}

export function IconProfile({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 19.2c.9-3.4 3.6-5.2 7.2-5.2s6.3 1.8 7.2 5.2" />
    </svg>
  );
}

export function IconRobot({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9 16.5h6" />
      <path d="M2.5 12h2.5" />
      <path d="M19 12h2.5" />
    </svg>
  );
}

export function IconLink({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 14.5l5-5" />
      <path d="M11 6.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13 17.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </svg>
  );
}

// 右箭头,只用于主 CTA 右侧的圆环按钮
export function IconArrowRight({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

// 品牌区的小印章:视觉上是"收藏级棋具"的鉴赏章,同时承担"规则"入口的
// 点击功能——比起在顶部导航单独放一个"规则"图标去跟好友/排行榜/我的
// 抢位置,把它藏进这枚本就该存在的装饰印章里,更符合参考图的极简顶栏。
export function IconSeal({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#A13A2E" />
      <rect x="2" y="2" width="20" height="20" rx="4" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontFamily="'Noto Serif SC', serif" fill="#F5EBDD">规</text>
    </svg>
  );
}

// 头像占位:没有 avatar_url 时使用的默认剪影,风格跟其余线性图标保持一致
export function IconAvatarFallback({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20c1-4 3.9-6 7.5-6s6.5 2 7.5 6" />
    </svg>
  );
}
