// 每日试炼的 NPC 名册。目前只有林墨一个,但"系统随机匹配一个NPC"这件
// 事本身要写成通用的,不要因为现在只有一个人就把逻辑写死——以后加新
// 棋手,理想情况下只需要往这个列表里加一条、再给 linmoDialogue.js 那样
// 配一套台词,不需要动 DailyTrialScreen 里的状态机。
//
// portrait 用的是已经在用的林墨立绘,dialogueKey 用来找该 NPC 对应的
// 台词模块(目前台词都在 lib/linmoDialogue.js 里,以后如果台词多到要
// 拆文件,可以把这个字段换成指向具体模块的引用)。
export const NPC_LIST = [
  {
    id: "linmo",
    name: "林墨",
    portrait: "/linmo-portrait.webp",
    scene: "/linmo-scene.jpg",
    sceneWebp: "/linmo-scene.webp",
  },
];

// 随机挑一个 NPC。excludeId 用于"换个对手"场景——优先不选中刚刚那位,
// 但目前名册里只有一个人,排除之后池子会是空的,这时候退回完整名册
// (也就是还会选中同一个人)。等名册里有多个人了,这行代码不用改,
// exclude 会自然生效。
export function pickRandomNpc(excludeId) {
  const pool = NPC_LIST.filter((n) => n.id !== excludeId);
  const finalPool = pool.length ? pool : NPC_LIST;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

export function getNpcById(id) {
  return NPC_LIST.find((n) => n.id === id) || NPC_LIST[0];
}
