// 结算揭晓页共用的小动画工具:数值补间 + 火花 + "飞行克隆"元素。
// 每日试炼结算页(DailyTrialResultReveal)和联机对战结算页
// (OnlineResultReveal)长得是同一套视觉语言,这几个纯函数抽到这里
// 统一维护,避免两个文件各存一份、以后改一处忘了改另一处。

// 通用数值补间:duration 内把 onUpdate(v) 从 from 平滑推到 to,easeOutCubic。
export function tween(from, to, duration, onUpdate, rafRef) {
  if (from === to) { onUpdate(to); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    onUpdate(from + (to - from) * eased);
    if (t < 1) rafRef.current = requestAnimationFrame(step);
  }
  rafRef.current = requestAnimationFrame(step);
}

export function spawnSparkles(layerEl, containerRect, sourceEl) {
  const r = sourceEl.getBoundingClientRect();
  const cx = r.left - containerRect.left + r.width / 2;
  const cy = r.top - containerRect.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const angle = ((Math.PI * 2) / 6) * i;
    const dist = 24 + Math.random() * 10;
    const s = document.createElement("span");
    s.className = "result-sparkle";
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    s.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    s.style.animationDelay = "480ms";
    layerEl.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

// 造一个"飞行克隆"元素:先在原地放大定住(带一点回弹),再一边缩小
// 一边真正飞向目标,落地跟目标精确中心重合。size/endSize 都是像素。
export function flyClone({ layerEl, containerRect, sourceEl, targetEl, size, endSize, content, delay, onLanded }) {
  const sRect = sourceEl.getBoundingClientRect();
  const tRect = targetEl.getBoundingClientRect();
  const startCx = sRect.left - containerRect.left + sRect.width / 2;
  const startCy = sRect.top - containerRect.top + sRect.height / 2;
  const endCx = tRect.left - containerRect.left + tRect.width / 2;
  const endCy = tRect.top - containerRect.top + tRect.height / 2;
  const dx = endCx - startCx, dy = endCy - startCy;
  const endScale = endSize / size;

  const el = document.createElement("div");
  el.className = "result-fly-item";
  el.style.left = startCx - size / 2 + "px";
  el.style.top = startCy - size / 2 + "px";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.innerHTML = content;
  layerEl.appendChild(el);

  const timeoutId = setTimeout(() => {
    el.style.opacity = "1";
    const appear = el.animate([
      { transform: "scale(0.3)", opacity: 0 },
      { transform: "scale(1.4)", opacity: 1, offset: 0.5 },
      { transform: "scale(0.95)", opacity: 1, offset: 0.75 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: 600, easing: "ease-out", fill: "forwards" });
    appear.onfinish = () => {
      const fly = el.animate([
        { transform: "translate(0,0) scale(1)", offset: 0 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 16}px) scale(${(1 + endScale) / 2})`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${endScale})`, offset: 1 },
      ], { duration: 800, easing: "cubic-bezier(.3,0,.55,1)", fill: "forwards" });
      fly.onfinish = () => {
        el.remove();
        onLanded?.();
      };
    };
  }, delay);
  return timeoutId;
}
