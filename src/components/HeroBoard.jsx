// 首页品牌核心视觉:收藏级棋盘展示。
//
// 之前这里是纯手绘 SVG 尝试还原设计图里的木盒棋盘,但棋院级的木纹、
// 光泽、透视质感很难用几行渐变代码逼近原图效果。既然设计图本身就是
// 现成的高质量成品图,这里改成直接使用从设计图裁切出来的棋盘实拍图
// (public/board-hero.jpg),四周极薄的一圈原图背景用 CSS mask 做羽化
// 过渡,融进页面自己的暖色背景里,而不是硬邦邦的矩形贴图边缘。
// 棋子、棋局摆法都是设计图原有的,不接收/不依赖任何真实对局数据,
// 跟真正用来下棋的 Board.jsx(15x15、可交互、接游戏状态)完全独立。

export default function HeroBoard() {
  return (
    <div className="hero-board-outer">
      <div className="hero-board-wrap">
        <img className="hero-board-photo" src="/board-hero.jpg" alt="棋盘装饰" />
      </div>
    </div>
  );
}
