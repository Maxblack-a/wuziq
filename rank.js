// 段位/等级展示工具:从 rating 派生"棋士/高手/棋圣"称号和 LV 数字,
// 纯展示层派生值,不写回数据库。MainMenu(顶栏身份牌)和 RoomScreen
// (对局房间 VS 双方等级徽章)都要用到同一套算法,抽到这里统一引用,
// 避免两处各算一套、哪天改了其中一个而忘了改另一个。

export function titleForRating(rating) {
  if (rating >= 1800) return "棋圣";
  if (rating >= 1400) return "高手";
  if (rating >= 1000) return "棋士";
  return "棋童";
}

export function levelForRating(rating) {
  return Math.max(1, Math.floor(((rating ?? 1200) - 800) / 40));
}
