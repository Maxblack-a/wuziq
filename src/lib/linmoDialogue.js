// 林墨的台词,集中放这一个文件方便统一调整语气,不散落在各个组件里。
// 写作原则(对齐角色设定文档):自然、礼貌、克制、聪明,不说人生哲理,
// 不自我介绍式地解释自己的设定——他的特点要通过对话行为体现,而不是
// 直接告诉玩家"我很会观察"。

import { DIM_LABELS as DIM_LABELS_FOR_TEXT } from "./skillProfile";

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
  "不过,我还挺好奇你下棋是什么风格——要不要和我下一局?",
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
//
// 命名规则:
// - "{阶段}_trigger" = 林墨主动抛出这个阶段的考验(林墨落子后触发)
// - "{阶段}_hit/partial/miss" = 玩家应对这个考验的结果揭晓(玩家落子后
//   触发)——这一组之前定义了但 skillTest.js 没接,导致整局下来玩家的
//   应对几乎不会得到任何针对性反馈,现在由 SkillTestScreen 在每次落子
//   后对比 checkpoints 是否新增来统一触发,不需要引擎显式返回。
// - "phase_{control|entice|net|closing}" = 阶段切换本身的过渡台词,让
//   "观察→控场→诱导→收网"这四段能各自被玩家感知到节奏在变,而不是从
//   头到尾一个语气。
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
  offense_partial: [
    "有威胁,但还差一口气。",
    "这一步够用,不算致命。",
    "抓到一条线了,只是没扩开。",
    "算你走对了方向。",
  ],
  offense_miss: [
    "这里其实还有别的路。",
    "机会刚才就在那儿,可惜了。",
    "嗯,这一段你走得偏保守。",
    "刚才那里,我以为你会动手。",
  ],
  global_trigger: [
    "这边我也走一步。",
    "棋盘上不止一处,你留意一下。",
    "别只看着这一块。",
    "我这边动一下。",
  ],
  global_hit: [
    "两头都照顾到了,不容易。",
    "看来你没被我牵着走。",
    "嗯,两边你都算进去了。",
    "这个大局观,可以。",
  ],
  global_partial: [
    "顾上了一头,另一头差一点。",
    "先手保住了,但没能两全。",
    "算是接住了,但不算从容。",
  ],
  global_miss: [
    "刚才那边,你好像没顾上。",
    "两处一起来,是有点难分神。",
    "这一下,棋盘另一头被我占了便宜。",
  ],
  game_start: [
    "你先来吧,我看看。",
    "开始了,你随意。",
    "第一步,你来。",
  ],
  // 观察阶段结束、正式开始"控场"(防守关卡窗口打开)——语气上要比
  // game_start 更专注一点,暗示"接下来我要认真看你怎么应了"
  phase_control: [
    "行,大概摸到你的路数了,认真一点。",
    "看得差不多了,我动真格的了。",
    "接下来,我不会让得太多了。",
  ],
  // 防守关卡结束、进入"诱导"(进攻窗口):故意放软,给玩家机会,语气上
  // 要体现"我先让一让,看你敢不敢"
  phase_entice: [
    "这一段,我松一松,你看着办。",
    "换你主动一点也行。",
    "我这边先不逼你了,你来。",
  ],
  // 进入"收网"(全局关卡):暗示棋盘不止一处、要开始考验全局观了
  phase_net: [
    "接下来我可能会两边都动一动。",
    "光顾着这一块,恐怕不太够了。",
    "该看看你顾不顾得过来了。",
  ],
  // 关卡都测完,进入收官:节奏收回来,暗示"复盘"即将开始——注意这不是
  // "游戏要结束了",只是"林墨从这一手开始不用再保持克制、可以认真下",
  // 棋还是要继续下到真正分出胜负才结束
  phase_closing: [
    "大概齐,我心里有数了。接下来我认真下了。",
    "行了,该看的也看得差不多了,剩下的就正常下吧。",
    "心里有数了,后面这盘我不让了。",
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
  attack: [
    "你几乎每一步都在往前顶,棋盘上留给自己的退路不多——但也正因为这样,我没什么喘息的机会。",
    "你的棋风就没打算跟我耗,一逮到机会就往前冲。",
    "跟你下棋,我几乎没有能松口气的时候,你一直在找进攻的缝。",
  ],
  defense: [
    "我好几次想往前冲,都被你不动声色地挡回来了。稳。",
    "你不是那种会主动惹事的棋手,但真要防起来,一点漏洞都不给我。",
    "我试探了你好几次,每次都被你不慌不忙地接住了。",
  ],
  vision: [
    "你好像一直都知道棋盘上还有别的地方需要照看,没有只盯着眼前这一小块。",
    "你看棋盘的方式跟大多数人不太一样——不是只盯着正在打的这一处。",
    "我想在别处偷个空,你基本都能察觉到。",
  ],
  calc: [
    "你选的点,大多数时候都是当时最好的那一个。",
    "你下棋很少浪费步数,基本每一手都算得清楚。",
    "你的落子几乎没有明显的失误手,挑不出太多毛病。",
  ],
  opening: [
    "前面几手棋摆得挺讲究,棋子和棋子之间都能接得上,不是随便找地方下的。",
    "你开局就有章法,不是想到哪下到哪那种。",
    "从第一手开始,你的棋就有一条能看出来的思路。",
  ],
  adapt: [
    "中间被我打乱过一次,你很快就调整回来了。",
    "被我搅乱节奏之后,你没自乱阵脚,几步就找回了状态。",
    "计划被打断了一下,但你没有慌,重新组织得很快。",
  ],
  attack_calc: [
    "进攻的时候几乎不浪费步数,想清楚了才动手。",
    "你的攻势不是硬冲,每一步都算得挺明白。",
    "杀棋杀得很干净,不拖泥带水。",
  ],
  defense_adapt: [
    "怎么搅都搅不乱,压力越大,你反而越沉得住气。",
    "我几次想打乱你的节奏,你都扛住了,没崩。",
    "你这种类型的棋手,越到后面越难对付。",
  ],
  vision_opening: [
    "你更像是在经营一整盘棋,而不是在打一场一场的小仗。",
    "你下棋有一种在铺局的感觉,不急着在某一处见输赢。",
    "比起眼前这一手,你好像更在乎整盘棋的走向。",
  ],
  balanced: [
    "各方面都还行,没有哪里明显是短板——这样的棋手,后面路子最宽。",
    "你这盘棋挑不出明显的弱点,哪一项都过得去。",
    "没有特别突出的一面,但也没有明显的漏洞,是那种很难被抓住破绽的类型。",
  ],
};

// 每种类型再补一句"这一局专属"的引用——从这盘棋的原始信号(checkpoints/
// moves)里挑一个具体细节说出来,而不是不管哪局都能套用的空话。
// highlights 由 lib/skillProfile.js 的 computeSkillProfile 从 testState
// 派生,取不到对应细节时(比如那一关这局没触发)就返回 null,调用方
// 会自动退回到只说 TYPE_COMMENT 那句通用点评,不会拼出语法不通的句子。
function citationFor(typeKey, highlights) {
  if (!highlights) return null;
  const { defense: d, offense: o, global: g, calc: c, opening: op, adapt: ad, totalMoves } = highlights;

  // 拆成"单维度引用"的字典,组合型人格(杀手型/磐石型/军师型)复用这
  // 两个字典里各自的那一句拼起来,而不是只引用其中一个维度——不然
  // 玩家两项数据都很亮眼,点评却只提了一半,浪费了另一半的真实细节。
  const single = {
    attack: () => {
      if (o?.result === "hit" && o.turn) return `第 ${o.turn} 手你摆出双活三那下,我是真被将了一军。`;
      if (o?.result === "partial" && o.turn) return `第 ${o.turn} 手你抓到了一个活三,只是没扩成真正的杀棋,再往前一步就更好看了。`;
      return null;
    },
    defense: () => {
      if (d?.result === "hit" && d.turn) return `第 ${d.turn} 手我逼你应招的时候,你接的就是最稳的那个点,几乎没犹豫。`;
      if (d?.result === "partial" && d.turn) return `第 ${d.turn} 手你把我挡住了,不算最干净,但顶住了。`;
      return null;
    },
    vision: () => {
      if (g?.result === "hit" && g.turn) return `第 ${g.turn} 手棋盘上同时有两处热闹,你两头都算进去了。`;
      if (g?.result === "partial" && g.turn) return `第 ${g.turn} 手棋盘分了两处,你先顾住了近的这头。`;
      return null;
    },
    calc: () => (c && c.total >= 3 ? `这一局 ${c.total} 步里有 ${c.near} 步都踩在当时最好的那个点上。` : null),
    opening: () => (op ? `开局那几手,你几乎每次都紧贴着自己已有的棋子往外扩,没有另起炉灶。` : null),
    adapt: () => (ad?.recovered ? `第 ${ad.missTurn} 手你被我趁虚而入,但没几步你就把节奏找回来了。` : null),
    balanced: () => (totalMoves ? `这一局正正经经下了 ${totalMoves} 手,没有哪一段是明显的短板。` : null),
  };

  const comboParts = {
    attack_calc: ["attack", "calc"],
    defense_adapt: ["defense", "adapt"],
    vision_opening: ["vision", "opening"],
  }[typeKey];

  if (comboParts) {
    const parts = comboParts.map((k) => single[k]()).filter(Boolean);
    return parts.length ? parts.join("") : null;
  }

  return single[typeKey] ? single[typeKey]() : null;
}

export function resultLine(typeKey, highlights) {
  const pool = TYPE_COMMENT[typeKey] || TYPE_COMMENT.balanced;
  const base = pool[Math.floor(Math.random() * pool.length)];
  const citation = citationFor(typeKey, highlights);
  return citation ? `${base}${citation}` : base;
}

// ---- 复测对比:跟上一次相比 / 最近这段时间 ----
// priorHistory:按时间倒序(最近的在前)的历史记录数组,每项 { dims, type,
// completedAt },来自 skill_test_history 表——这张表在每次测试完成时都会
// 追加一行,不影响 profiles.skill_test_* 那几列(它们仍然只代表"最新一次"、
// 给每日试炼这类功能读取,互不干扰)。priorHistory 可能是 undefined/空
// 数组(第一次测试、或者调用方没查历史),这两种情况下面两个函数都直接
// 返回 null,由结果页决定不渲染对比区块。
const DIM_ORDER = ["attack", "defense", "vision", "calc", "opening", "adapt"];

// 相比上一次:挑变化最大的 1-2 个维度说,不逐项念一遍六个数字——念完
// 六个数字的涨跌,听起来像体检报告,不像一个人在跟你聊感受。
export function compareToLastLine(dims, priorHistory) {
  const last = priorHistory && priorHistory[0];
  if (!last || !last.dims) return null;

  const deltas = DIM_ORDER
    .map((k) => ({ key: k, delta: (dims[k] ?? 0) - (last.dims[k] ?? 0) }))
    .filter((d) => Math.abs(d.delta) >= 8) // 差距太小(棋局本身的随机波动)不值得拿出来说
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  if (!deltas.length) {
    return "跟上次比,整体感觉差不多,没什么明显变化。";
  }

  const top = deltas[0];
  const label = DIM_LABELS_FOR_TEXT[top.key];
  const risePhrases = [`这次${label}比上次明显好了不少。`, `${label}这一项,比上次沉稳/干净了不少。`];
  const fallPhrases = [`不过这次${label}没有上次稳,像是有点分心。`, `${label}这一项,这次反而不如上次。`];
  const primary = top.delta > 0
    ? risePhrases[Math.floor(Math.random() * risePhrases.length)]
    : fallPhrases[Math.floor(Math.random() * fallPhrases.length)];

  if (deltas.length === 1 || Math.abs(deltas[1].delta) < 14) {
    return primary;
  }

  // 有第二个也很明显的变化,而且方向跟第一个不一样,顺带提一句,让对比
  // 显得更像"整体地聊了聊",而不是只挑一个数字
  const second = deltas[1];
  const secondLabel = DIM_LABELS_FOR_TEXT[second.key];
  const secondClause = second.delta > 0
    ? `,${secondLabel}倒是比上次更好了`
    : `,倒是${secondLabel}这次弱了一点`;
  return `${primary}${secondClause}。`;
}

// 最近这段时间:至少要有 3 次记录(算上这次)才谈得上"趋势",少于这个
// 数量,"最近怎么样"这句话本身就没有底气说出口——宁可不说,也不要
// 拿两个点硬编一条"趋势线"出来。
export function recentTrendLine(dims, priorHistory) {
  if (!priorHistory || priorHistory.length < 2) return null;

  // 连同这一次在内最多取最近 4 次,按时间正序排(方便算"早->晚"的走势)
  const recent = [...priorHistory].slice(0, 3).reverse();
  const series = [...recent.map((h) => h.dims), dims];

  const hiddenAvg = (d) => DIM_ORDER.reduce((s, k) => s + (d[k] ?? 0), 0) / DIM_ORDER.length;
  const avgs = series.map(hiddenAvg);
  const trendDelta = avgs[avgs.length - 1] - avgs[0];

  // 找这几次里最稳定进步的单项(每一步都不比上一步差,且总体涨了不少)
  const steadyDim = DIM_ORDER.find((k) => {
    const vals = series.map((d) => d[k] ?? 0);
    const monotonic = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 5);
    return monotonic && vals[vals.length - 1] - vals[0] >= 15;
  });

  if (steadyDim) {
    return `这几次测下来,你的${DIM_LABELS_FOR_TEXT[steadyDim]}是一次比一次稳的,看得出来是真的在往这个方向练。`;
  }
  if (trendDelta >= 10) {
    return "最近这几次感觉你整体状态是在往上走的,比刚认识你那会儿更沉得住气了。";
  }
  if (trendDelta <= -10) {
    return "最近这几次跟前几次比,感觉你的状态有点起伏,不知道是不是最近比较忙。";
  }
  return "最近这几次下来,你的水平其实一直很稳定,没有太大起伏。";
}

export const RESULT_CONTINUE_LABEL = "继续";
