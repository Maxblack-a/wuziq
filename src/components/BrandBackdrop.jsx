// 首页专属的背景装饰:左上角竹叶剪影 + 右上角水墨远山,直接使用从
// 设计图裁切出来的两小块实拍/实绘图(public/bamboo-deco.jpg、
// public/mountain-deco.jpg),用 mix-blend-mode: multiply 叠加到页面
// 背景上——因为这两张图本身底色是浅色宣纸调,乘法混合会让浅色部分
// 几乎"消失"融入页面背景,只留下深色的墨迹线条,不需要额外抠图,
// 也不会出现方形贴图的生硬边缘。纯装饰,aria-hidden、不接受任何点击。
export default function BrandBackdrop() {
  return (
    <div className="brand-backdrop" aria-hidden="true">
      <img className="backdrop-bamboo" src="/bamboo-deco-trimmed.jpg" alt="" />
      <img className="backdrop-mountain" src="/mountain-deco.jpg" alt="" />
    </div>
  );
}
