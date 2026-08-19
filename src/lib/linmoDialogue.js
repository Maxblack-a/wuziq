// 林墨的台词,集中放这一个文件方便统一调整语气,不散落在各个组件里。
// 写作原则(对齐角色设定文档):自然、礼貌、克制、聪明,不说人生哲理,
// 不自我介绍式地解释自己的设定——他的特点要通过对话行为体现,而不是
// 直接告诉玩家"我很会观察"。

export const GREETING_LINES = [
  "哎,你就是那个新来的棋手吧?",
];

export const NAME_PROMPT_LINE = "你好,我叫林墨。你叫什么名字啊?";
export const NAME_HINT = "林墨会记住这个名字";

// 复测(从"我的"页面主动发起,不是新用户见面那一次)用的招呼语——不用
// 再问名字,林墨已经认识你了,语气上要体现"认识"和"再来一次"这两点,
// 跟第一次见面的陌生感区分开。
export function retakeGreetingLine(name) {
  const n = name ? name : "";
  const variants = [
    `${n}又来啦?这次让我再看看你的棋。`,
    `想再测一次?行啊,${n},来吧。`,
    `${n},好久没在棋盘前见你了——要不要再下一局?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

export const RETAKE_ACCEPT_LABEL = "开始";
export const RETAKE_CANCEL_LABEL = "再想想";

// 邀请下第一局测试局:按玩家昵称的"感觉"给一句克制、自然的反馈,
// 再顺势带出"想看看你的棋"这个邀请——目标是让玩家觉得"林墨对我这个
// 人有点兴趣,想跟我下一局",而不是"系统提示我去完成一个棋力测试
// 任务"。所以全程不出现"测试""棋力"这类系统化的词。
//
// 昵称分类只是一个粗略的启发式判断,不追求完全准确——判断错了也没
// 关系,反馈本身写得足够克制、留有余地,不会显得像在下断言。
function categorizeNickname(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "special";
  const chars = Array.from(trimmed);
  // 叠字/重复模式(比如"夏夏""KK""洋洋"),这类昵称通常给人的感觉
  // 比较可爱、亲切,优先判断
  if (chars.length >= 2 && chars.length % 2 === 0) {
    const half = chars.length / 2;
    const first = chars.slice(0, half).join("");
    const second = chars.slice(half).join("");
    if (first.toLowerCase() === second.toLowerCase()) return "cute";
  }
  if (chars.length <= 2) return "simple";
  return "special";
}

const NAME_REACTION_LINES = {
  cute: [
    "这个名字听起来挺可爱的。",
    "这名字,有点意思,挺可爱。",
  ],
  special: [
    "这个名字挺特别。",
    "这名字,倒是第一次听到。",
  ],
  simple: [
    "简单的名字,也很有记忆点。",
    "名字挺干脆。",
  ],
};

const NAME_INVITE_FOLLOWUPS = [
  "不过,我还挺好奇你的棋力怎么样——要不要和我下一局?",
  "正好棋馆现在没什么人,陪我下一局?我想看看你的棋。",
  "既然认识了,那我倒挺想看看你下棋是什么风格的。",
];

export function inviteLine(name) {
  const category = categorizeNickname(name);
  const reactionPool = NAME_REACTION_LINES[category];
  const reaction = reactionPool[Math.floor(Math.random() * reactionPool.length)];
  const followup = NAME_INVITE_FOLLOWUPS[Math.floor(Math.random() * NAME_INVITE_FOLLOWUPS.length)];
  return `${reaction}${followup}`;
}

export const INVITE_ACCEPT_LABEL = "和林墨下一局";
export const INVITE_SKIP_LABEL = "改天吧";

export const SKIP_RESPONSE_LINE = "行,那就改天。棋馆一直都在。";

// 测试局过程中的即时点评——只在关卡触发/结束这几个明确时机说,不是
// 每一步都插话。每个 key 下多备几条候选,随机挑一条,尽量别让老玩家
// 第二次测试(或者旁边看直播的人)一眼就看出是在念固定台词。
export const IN_GAME_LINES = {
  defense_trigger: [
    "这边,我随手落一子。",
    "嗯,该你了。",
    "我下这里,你看看。",
    "轮到你了。",
  ],
  defense_hit: [
    "反应挺快。",
    "看来这个你很熟。",
    "挡得很干净。",
    "嗯,这手不错。",
  ],
  defense_partial: [
    "挡是挡住了。",
    "算是防住了,不算最干净的那种。",
    "有惊无险。",
    "这样也行,不算最优。",
  ],
  defense_miss: [
    "你刚才是不是犹豫了一下?",
    "……这里其实有点危险。",
    "这边你好像没太留意。",
    "嗯,这里我可以走了。",
  ],
  offense_hit: [
    "两条线一起来,可以。",
    "这一手,我倒没想到。",
    "两边都顾上了,厉害。",
    "这个组合,挺干净的。",
  ],
  global_trigger: [
    "这边我也走一步。",
    "棋盘上不止一处,你留意一下。",
    "别只看着这一块。",
    "我这边动一下。",
  ],
  game_start: [
    "你先来吧,我看看。",
    "开始了,你随意。",
    "第一步,你来。",
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
export const RESULT_INTRO_LINE_RETAKE = "又下完一局。有些地方跟我记得的不太一样了。";

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
