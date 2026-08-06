// 首页品牌核心视觉:收藏级棋盘展示。
//
// 就是设计图裁出来的这一张棋盘照片(board-hero-crop.jpg,只做了简单的
// 矩形裁切收紧边距,没有抠图、没有另外拼阴影),诚实地当一张照片来
// 用:圆角 + 一个标准 CSS box-shadow,不再尝试用遮罩/多层混合去"骗"
// 出无缝融入背景的效果。
// 棋子、棋局摆法都是设计图原有的,不接收/不依赖任何真实对局数据,
// 跟真正用来下棋的 Board.jsx(15x15、可交互、接游戏状态)完全独立。

export default function HeroBoard() {
  return (
    <div className="hero-board-outer">
      <div className="hero-board-wrap">
        <img className="hero-board-photo" src="/board-hero-crop.jpg" alt="棋盘装饰" />
      </div>
    </div>
  );
}
