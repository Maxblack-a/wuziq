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

/* ============================================================
   以下为「对局房间」重新设计新增的图标,风格跟上面保持一致
   (线性 currentColor)
   ============================================================ */

// 返回箭头(细线 chevron,替换掉原来纯文本的 "← 返回")
export function IconChevronLeft({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconChevronRight({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

// 房间顶栏右上角的"更多"入口
export function IconMoreHorizontal({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

// "开始匹配"按钮左侧的筹码/铜钱堆图标
export function IconCoinStack({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="16.2" rx="7.2" ry="2.6" />
      <ellipse cx="12" cy="12" rx="7.2" ry="2.6" />
      <ellipse cx="12" cy="7.8" rx="7.2" ry="2.6" />
    </svg>
  );
}

// "开始游戏"按钮左侧的播放三角
export function IconPlay({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

// 邀请好友按钮左侧的"加好友"图标
export function IconPersonPlus({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.2" r="3.2" />
      <path d="M3 19c.8-3.4 3.2-5.2 6-5.2s5.2 1.8 6 5.2" />
      <path d="M18 7.5v5" />
      <path d="M15.5 10h5" />
    </svg>
  );
}

// 底部提示文案前的信息圆圈
export function IconInfoCircle({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 标题两侧的小菱形装饰章
export function IconDiamondOutline({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)" />
    </svg>
  );
}

// 搜索昵称加好友:输入框左侧的放大镜
export function IconSearch({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </svg>
  );
}

// 好友申请 · 同意
export function IconCheck({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5l5 5L20 7" />
    </svg>
  );
}

// 好友申请 · 拒绝/取消
export function IconClose({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// 人机对战 · 悔棋(逆时针回退箭头,跟"返回"的 chevron 区分开,
// 一眼能看出这是"撤销上一步"而不是"离开页面")
export function IconUndo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10H15.5C18 10 20 12 20 14.5C20 17 18 19 15.5 19H10" />
      <path d="M10 6.5L6 10L10 13.5" />
    </svg>
  );
}
