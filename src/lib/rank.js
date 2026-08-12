// 段位/等级展示工具:从 exp(经验值)派生"棋童/棋士/高手/大师/宗师/棋圣"称号和阶数,
// 纯展示层派生值,不写回数据库。MainMenu(顶栏身份牌)和 RoomScreen
// (对局房间 VS 双方等级徽章)都要用到同一套算法,抽到这里统一引用,
// 避免两处各算一套、哪天改了其中一个而忘了改另一个。
//
// 规则:6 个称号,每个称号下分 5 阶。越往后每一阶跨度越大(升级曲线放缓),
// 从 0 分起步,只涨不降:
//   棋童 每阶100分  0-499    (0-99/100-199/200-299/300-399/400-499)
//   棋士 每阶200分  500-1499
//   高手 每阶300分  1500-2999
//   大师 每阶400分  3000-4999
//   宗师 每阶500分  5000-7499
//   棋圣 7500+,沿用宗师的500分跨度继续分阶,9500+ 封顶显示为棋圣5阶
const TIERS = [
  { name: "棋童", start: 0, width: 100 },
  { name: "棋士", start: 500, width: 200 },
  { name: "高手", start: 1500, width: 300 },
  { name: "大师", start: 3000, width: 400 },
  { name: "宗师", start: 5000, width: 500 },
  { name: "棋圣", start: 7500, width: 500 },
];
const LEVELS_PER_TITLE = 5;

function tierIndexForExp(exp) {
  const e = exp ?? 0;
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (e >= TIERS[i].start) idx = i;
  }
  return idx;
}

export function titleForExp(exp) {
  return TIERS[tierIndexForExp(exp)].name;
}

// 返回当前称号下的"阶"(1-5),配合 titleForExp 使用,
// 例如 titleForExp(650) + levelForExp(650) + "阶" => "棋士1阶"
export function levelForExp(exp) {
  const e = exp ?? 0;
  const tier = TIERS[tierIndexForExp(e)];
  const raw = Math.floor((e - tier.start) / tier.width) + 1;
  return Math.min(LEVELS_PER_TITLE, Math.max(1, raw));
}

// 完整段位标签,如 "棋士2阶"
export function rankLabelForExp(exp) {
  return `${titleForExp(exp)}${levelForExp(exp)}阶`;
}

// 当前阶内的进度百分比(0-100),每个称号内部各阶跨度不一样(棋童100分/阶,
// 棋圣及以上500分/阶……),所以进度条要按当前所在阶的实际跨度算,不能写死。
// 棋圣5阶(9500+)之后已经没有"下一阶"了,固定显示满格。
export function progressPctForExp(exp) {
  const e = exp ?? 0;
  const idx = tierIndexForExp(e);
  const tier = TIERS[idx];
  const level = levelForExp(e);
  if (idx === TIERS.length - 1 && level >= LEVELS_PER_TITLE && e >= tier.start + (LEVELS_PER_TITLE - 1) * tier.width + tier.width) {
    return 100;
  }
  const levelStart = tier.start + (level - 1) * tier.width;
  const pct = ((e - levelStart) / tier.width) * 100;
  return Math.min(100, Math.max(0, pct));
}

// 当前阶内"已攒了多少/这一阶总共需要多少",例如 "0/100"、"140/200"——
// 首页身份牌进度条下方、"我的"页面头像旁都用这个,展示的是阶内相对值,
// 不是 profiles.exp 那个从0开始只涨不降的绝对总分(那个数字对玩家没有
// "还差多少能升级"这么直观)。棋圣5阶封顶之后没有下一阶,固定显示满格。
export function expProgressText(exp) {
  const e = exp ?? 0;
  const idx = tierIndexForExp(e);
  const tier = TIERS[idx];
  const level = levelForExp(e);
  const isMaxed = idx === TIERS.length - 1 && level >= LEVELS_PER_TITLE
    && e >= tier.start + (LEVELS_PER_TITLE - 1) * tier.width + tier.width;
  if (isMaxed) return `${tier.width}/${tier.width}`;
  const levelStart = tier.start + (level - 1) * tier.width;
  const current = Math.max(0, Math.min(tier.width, Math.round(e - levelStart)));
  return `${current}/${tier.width}`;
}

// 兼容旧命名(之前叫 rating,函数名是 titleForRating/levelForRating),
// 保留这两个别名,避免遗漏某个引用没改到时直接报错。新代码请用上面 xxxForExp。
export const titleForRating = titleForExp;
export const levelForRating = levelForExp;
