import { useEffect, useState } from "react";
import { getDebugSnapshot } from "../lib/telegram";

// 临时排查"棋盘尺寸不对"问题专用的调试面板——不用去翻控制台,打开页面
// 直接就能看到、截图发过来就行。排查完这个问题之后整个组件和它在
// XiangqiPveScreen/XiangqiOnlineGame 等地方的引用可以一起删掉。
export default function XqDebugBadge() {
  const [snap, setSnap] = useState(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // 等一小会儿再采集,确保棋盘已经渲染完、--app-height 也已经被
    // initTelegram() 设置过了,不然会拿到还没就绪的过渡态数据。
    const t1 = setTimeout(() => setSnap(getDebugSnapshot()), 50);
    const t2 = setTimeout(() => setSnap(getDebugSnapshot()), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (!visible || !snap) return null;

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 99999,
        background: "rgba(0,0,0,0.88)", color: "#7CFC7C",
        fontFamily: "monospace", fontSize: 10.5, lineHeight: 1.5,
        padding: "8px 10px", maxHeight: "55vh", overflowY: "auto",
        whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <b style={{ color: "#fff" }}>棋盘诊断信息(截图发给开发者)</b>
        <span onClick={() => setVisible(false)} style={{ color: "#f88", padding: "0 6px" }}>关闭 ✕</span>
      </div>
      {`Telegram版本: ${snap.tgVersion}  平台: ${snap.tgPlatform}
viewportHeight: ${snap.viewportHeight}  viewportStableHeight: ${snap.viewportStableHeight}
window内部尺寸: ${snap.windowInner}  DPR: ${snap.dpr}
--app-height变量: ${snap.appHeightVar}
浏览器支持aspect-ratio: ${snap.supportsAspectRatio}

.app-shell: ${JSON.stringify(snap.appShell)}
.game-board-col: ${JSON.stringify(snap.gameBoardCol)}
.xq-board-wrap: ${JSON.stringify(snap.xqBoardWrap)}

UA: ${snap.ua}`}
    </div>
  );
}
