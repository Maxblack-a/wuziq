// 对 window.Telegram.WebApp 做一层薄封装,方便在非 Telegram 环境下也不报错
import { useEffect, useRef } from "react";

const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;

export const isInTelegram = !!tg?.initData;

export function initTelegram() {
  if (!tg) {
    setupViewportHeightVar(); // 浏览器里也走一遍,保证非Telegram环境下同样表现
    return;
  }
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.(tg.themeParams?.bg_color || "#15181B");
  tg.disableVerticalSwipes?.();
  setupViewportHeightVar();
}

// 100vh 在 Telegram 内嵌 WebView 里不可靠(键盘弹出、头部栏收起展开都不会跟着变),
// 改成用 Telegram 汇报的真实可视高度,写成 CSS 变量给布局用
function setupViewportHeightVar() {
  function update() {
    const h = tg?.viewportStableHeight || window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${h}px`);
  }
  update();
  tg?.onEvent?.("viewportChanged", update);
  window.addEventListener("resize", update);
}

export function getInitData() {
  return tg?.initData || "";
}

// 当前这个 WebView 里,Telegram 报告的用户 id(不是我们数据库里的,是 Telegram 自己的)。
// 用来跟本地缓存的登录态做核对,防止同一设备切换过 Telegram 账号时沿用了错的登录态。
export function getTelegramUserId() {
  return tg?.initDataUnsafe?.user?.id ?? null;
}

// 深链接携带的房间邀请码:t.me/bot/app?startapp=CODE123
export function getStartParam() {
  return tg?.initDataUnsafe?.start_param || null;
}

export function hapticImpact(style = "light") {
  tg?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotify(type = "success") {
  tg?.HapticFeedback?.notificationOccurred(type);
}

// 分享邀请链接。在 Telegram 里会打开原生分享面板;在普通浏览器里(调试用)
// 之前这里其实什么都没做——按钮文案说"复制链接"但没有真的写进剪贴板,
// 点了跟没点一样。现在补上真正的剪贴板写入,并把结果返回给调用方展示反馈。
export async function shareInviteLink(code, botUsername, appShortName) {
  const link = `https://t.me/${botUsername}/${appShortName}?startapp=${code}`;

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("来五子棋对战,点进来直接开局 ♟")}`
    );
    return { copied: false, shared: true, link };
  }

  try {
    await navigator.clipboard.writeText(link);
    return { copied: true, shared: false, link };
  } catch {
    return { copied: false, shared: false, link };
  }
}

export function getThemeParams() {
  return tg?.themeParams || {};
}

export function onThemeChanged(cb) {
  tg?.onEvent?.("themeChanged", cb);
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) {
      tg.showConfirm(message, (confirmed) => resolve(confirmed));
    } else {
      resolve(window.confirm(message));
    }
  });
}

export function closeApp() {
  tg?.close?.();
}

// Telegram 原生返回按钮:接管它,而不是让系统默认行为(可能直接把小程序关掉/退出)
// 绕过我们自己的业务逻辑(比如对局中点返回应该先弹认输确认)。
// 内部用 ref 存最新的回调,只挂载一次——这样调用方就算每次渲染传进来的是
// 一个新的内联函数(引用不稳定),也不会导致重复 show/hide/onClick/offClick
export function useTelegramBackButton(onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!tg?.BackButton) return;
    const handler = () => onBackRef.current?.();
    tg.BackButton.show();
    tg.BackButton.onClick(handler);
    return () => {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// 对局进行中拦截 Telegram 的原生关闭手势(下滑关闭 / 点 X),弹出"确定要离开吗"
// 避免用户一个手滑就直接把小程序关了,棋局晾在那没法结算也没法回去
export function setClosingConfirmation(enabled) {
  if (enabled) tg?.enableClosingConfirmation?.();
  else tg?.disableClosingConfirmation?.();
}
