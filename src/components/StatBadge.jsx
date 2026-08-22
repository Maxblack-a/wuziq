import { useEffect, useRef, useState } from "react";

// 数字变化时的标准"游戏化反馈"三件套,参考大部分手游对经验/货币/体力
// 这类资源变化的处理方式,而不是让数字悄无声息地直接跳到新值:
// 1. 数字本身从旧值平滑滚到新值(不是瞬间跳变)
// 2. 图标跟着弹一下(涨:放大回弹;跌:轻微收缩),给一个"打在这"的反馈
// 3. 变化量以"+N"/"-N"的形式在图标上方浮起、渐隐消失
// 触发条件是"起点值跟当前值不一样"——可以是同一个组件生命周期内 value
// 自己变了,也可以是组件刚挂载时传进来的 fromValue 跟 value 不一样
// (见下面 StatBadge 的 fromValue 说明)。首次出现且没有起点可比较时
// 不放这套动画,不然一进页面所有数字都在"凭空跳出来",反而显得廉价。
function useAnimatedValue(value, fromValue, duration = 650) {
  const initial = typeof fromValue === "number" ? fromValue : value;
  const [displayValue, setDisplayValue] = useState(initial);
  const [delta, setDelta] = useState(0);
  const [popKey, setPopKey] = useState(0);
  const prevRef = useRef(initial);
  const rafRef = useRef(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;

    if (typeof prev !== "number" || typeof value !== "number" || value === prev) {
      setDisplayValue(value);
      return;
    }

    const diff = value - prev;
    setDelta(diff);
    setPopKey((k) => k + 1);

    const from = prev;
    const to = value;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic:快启动、慢收尾,比匀速滚动更"跟手"
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return { displayValue, delta, popKey };
}

// icon: 一个图标元素(比如 <IconGem size={13} />);value: 当前数值;
// fromValue: 挂载时应该从哪个数字开始滚——不给就直接显示 value,不播放
// 动画(第一次看到这个数字,没有"变化"这回事)。给了就在组件刚挂载的
// 那一刻,从 fromValue 滚到 value 并弹一下,典型场景是"从每日试炼玩完
// 一局回到首页"这种跨页面的数值变化,组件本身是重新挂载的,没法靠
// "上一次渲染的值"这种组件内部状态去比较,所以由外层(App.jsx)记住
// "离开首页前是什么样子",挂载时当作起点传进来。
export default function StatBadge({ icon, value, fromValue, className = "" }) {
  const { displayValue, delta, popKey } = useAnimatedValue(value, fromValue);
  const isPositive = delta > 0;
  const isNegative = delta < 0;

  return (
    <div className={`stat-badge ${className}`}>
      <span
        key={`icon-${popKey}`}
        className={`stat-badge-icon${isPositive ? " stat-pop-up" : isNegative ? " stat-pop-down" : ""}`}
      >
        {icon}
      </span>
      <span className="stat-badge-value">{displayValue ?? "–"}</span>
      {delta !== 0 && (
        <span
          key={`float-${popKey}`}
          className={`stat-badge-float${isPositive ? " positive" : " negative"}`}
          aria-hidden="true"
        >
          {isPositive ? `+${delta}` : delta}
        </span>
      )}
    </div>
  );
}
