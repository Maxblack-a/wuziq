// 首页专属的背景装饰:左上角竹叶剪影 + 右上角水墨远山。
// 这两张图之前是普通JPG(自带一块浅色矩形底),靠 mix-blend-mode:
// multiply 去"隐藏"那块底色——但JPG的浅色底跟页面暖米白色终究是两个
// 不同的色值,乘法混合只会削弱、不会消除,叠加起来就会在图片的矩形
// 范围内露出一块能被肉眼察觉的色块。现在直接用 OpenCV 抠成真正透明
// 背景的 PNG(只保留墨迹线条本身的 alpha),不再需要任何混合模式戏法,
// 图片范围之外就是纯粹的 0 透明,不会有矩形边界。纯装饰,aria-hidden、
// 不接受任何点击。
export default function BrandBackdrop() {
  return (
    <div className="brand-backdrop" aria-hidden="true">
      <img className="backdrop-bamboo" src="/bamboo-deco-cutout.png" alt="" />
      <img className="backdrop-mountain" src="/mountain-deco-cutout.png" alt="" />
    </div>
  );
}
