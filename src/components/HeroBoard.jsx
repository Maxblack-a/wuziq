// 首页品牌核心视觉:收藏级棋盘展示。
//
// board-hero-cutout.png 是把原设计图里棋盘四周的灰调摄影棚背景真正抠掉
// 之后的透明底 PNG(只保留棋盘本体 + 棋盘自带的柔和接触阴影),不再用
// CSS 径向遮罩去"猜"哪里该透明——之前那种做法在棋盘四角总会露出一圈
// 原图背景色和页面暖米白色不一致的雾斑。现在图片本身就是干净的透明
// 背景,直接叠在页面底色上,边缘天然干净。
// 棋子、棋局摆法都是设计图原有的,不接收/不依赖任何真实对局数据,
// 跟真正用来下棋的 Board.jsx(15x15、可交互、接游戏状态)完全独立。

export default function HeroBoard() {
  return (
    <div className="hero-board-outer">
      <div className="hero-board-wrap">
        <img className="hero-board-photo" src="/board-hero-cutout.png" alt="棋盘装饰" />
      </div>
    </div>
  );
}
