// 林墨的台词,集中放这一个文件方便统一调整语气,不散落在各个组件里。
// 写作原则(对齐角色设定文档):自然、礼貌、克制、聪明,不说人生哲理,
// 不自我介绍式地解释自己的设定——他的特点要通过对话行为体现,而不是
// 直接告诉玩家"我很会观察"。

export const GREETING_LINES = [
  "哎,你就是那个新来的棋手吧?",
];

export const NAME_PROMPT_LINE = "你好,我叫林墨。你叫什么名字啊?";
export const NAME_HINT = "林墨会记住这个名字";

export function inviteLine(name) {
  return `${name},既然认识了名字,那我倒想看看你的棋——陪我下一局?`;
}

export const INVITE_ACCEPT_LABEL = "好啊";
export const INVITE_SKIP_LABEL = "改天吧";

export const SKIP_RESPONSE_LINE = "行,那就改天。棋馆一直都在。";

// 测试局过程中的即时点评——只在关卡触发/结束这几个明确时机说,不是
// 每一步都插话。每个 key 下给 2 条候选,随机挑一条,避免每次都一样。
export const IN_GAME_LINES = {
  defense_trigger: [
    "这边,我随手落一子。",
    "嗯,该你了。",
  ],
  defense_hit: [
    "反应挺快。",
    "看来这个你很熟。",
  ],
  defense_partial: [
    "挡是挡住了。",
    "算是防住了,不算最干净的那种。",
  ],
  defense_miss: [
    "你刚才是不是犹豫了一下?",
    "……这里其实有点危险。",
  ],
  offense_hit: [
    "两条线一起来,可以。",
    "这一手,我倒没想到。",
  ],
  global_trigger: [
    "这边我也走一步。",
    "棋盘上不止一处,你留意一下。",
  ],
  game_start: [
    "你先来吧,我看看。",
  ],
};

export function pickInGameLine(key) {
  const pool = IN_GAME_LINES[key];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 结果揭晓:开场白 + 每种类型对应一句"点评"(不是解释规则,是像真的在
// 复盘这盘棋一样说一句有信息量的话)
export const RESULT_INTRO_LINE = "下完了。让我想想怎么说……";

export const TYPE_COMMENT = {
  attack: "你几乎每一步都在往前顶,棋盘上留给自己的退路不多——但也正因为这样,我没什么喘息的机会。",
  defense: "我好几次想往前冲,都被你不动声色地挡回来了。稳。",
  vision: "你好像一直都知道棋盘上还有别的地方需要照看,没有只盯着眼前这一小块。",
  calc: "你选的点,大多数时候都是当时最好的那一个。",
  opening: "前面几手棋摆得挺讲究,棋子和棋子之间都能接得上,不是随便找地方下的。",
  adapt: "中间被我打乱过一次,你很快就调整回来了。",
  attack_calc: "进攻的时候几乎不浪费步数,想清楚了才动手。",
  defense_adapt: "怎么搅都搅不乱,压力越大,你反而越沉得住气。",
  vision_opening: "你更像是在经营一整盘棋,而不是在打一场一场的小仗。",
  balanced: "各方面都还行,没有哪里明显是短板——这样的棋手,后面路子最宽。",
};

export function resultLine(typeKey) {
  return TYPE_COMMENT[typeKey] || TYPE_COMMENT.balanced;
}

export const RESULT_CONTINUE_LABEL = "继续";
