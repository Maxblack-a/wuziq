// 每日试炼的 NPC 名册。"系统随机匹配一个NPC"这件事本身写成通用的,
// 不因为人数少就把逻辑写死——加新棋手只需要往这个列表里加一条、再在
// lib/dailyDialogue.js 里给这个 id 配一套台词,不需要动 DailyTrialScreen
// / DailyTrialGameScreen 里的状态机。
//
// 每个 NPC 的 id 同时也是 lib/dailyDialogue.js 里台词表的 key(见该文件
// DAILY_VOICES 的结构),两边的 id 必须一一对应——加新棋手时这两处要
// 一起改,少配一处会导致台词退回默认语气。
export const NPC_LIST = [
  {
    id: "linmo",
    name: "林墨",
    portrait: "/linmo-portrait.webp",
    scene: "/linmo-scene.jpg",
    sceneWebp: "/linmo-scene.webp",
  },
  {
    id: "suqing",
    name: "苏晴",
    portrait: "/suqing-portrait.webp",
    scene: "/suqing-scene.jpg",
    sceneWebp: "/suqing-scene.webp",
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
