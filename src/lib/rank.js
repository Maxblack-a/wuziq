// 段位/等级展示工具:从 rating 派生"棋童/棋士/高手/大师/宗师/棋圣"称号和阶数,
// 纯展示层派生值,不写回数据库。MainMenu(顶栏身份牌)和 RoomScreen
// (对局房间 VS 双方等级徽章)都要用到同一套算法,抽到这里统一引用,
// 避免两处各算一套、哪天改了其中一个而忘了改另一个。
//
// 规则:6 个称号,每个称号下分 5 阶,每阶横跨 100 分,从 0 分起步:
//   棋童 0-499(1阶 0-99 ... 5阶 400-499)
//   棋士 500-999
//   高手 1000-1499
//   大师 1500-1999
//   宗师 2000-2499
//   棋圣 2500+ (2900-2999 封顶为 5 阶,更高分数依然显示棋圣5阶)
// 负分(积分允许为负)按棋童1阶展示,不单独再往下分档。

const TITLES = ["棋童", "棋士", "高手", "大师", "宗师", "棋圣"];
const LEVELS_PER_TITLE = 5;
const POINTS_PER_LEVEL = 100;
const MAX_LEVEL_INDEX = TITLES.length * LEVELS_PER_TITLE - 1; // 29,对应棋圣5阶

function levelIndexForRating(rating) {
  const r = rating ?? 0;
  const raw = Math.floor(r / POINTS_PER_LEVEL);
  return Math.min(MAX_LEVEL_INDEX, Math.max(0, raw));
}

export function titleForRating(rating) {
  const idx = levelIndexForRating(rating);
  return TITLES[Math.floor(idx / LEVELS_PER_TITLE)];
}

// 返回当前称号下的"阶"(1-5),配合 titleForRating 使用,
// 例如 titleForRating(650) + levelForRating(650) + "阶" => "棋士2阶"
export function levelForRating(rating) {
  const idx = levelIndexForRating(rating);
  return (idx % LEVELS_PER_TITLE) + 1;
}

// 完整段位标签,如 "棋士2阶"
export function rankLabelForRating(rating) {
  return `${titleForRating(rating)}${levelForRating(rating)}阶`;
}
