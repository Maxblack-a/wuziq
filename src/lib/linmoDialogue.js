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
  // 关卡都测完,进入收官:节奏收回来,暗示"复盘"即将开始
  phase_closing: [
    "大概齐,我心里有数了。",
    "行了,该看的也看得差不多了。",
    "剩下这几手,随便下下就好。",
  ],
};

export function pickInGameLine(key) {
  const pool = IN_GAME_LINES[key];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 关卡有没有全测完,直接决定了结果揭晓时要不要先说明"这局没测全"——
// 玩家在对局过程中很难自己意识到"某一关被跳过了",这份坦白放在揭晓
// 页最自然,不用在对局里刻意提示打断节奏。
export const INCOMPLETE_NOTE_LINES = [
  "这局有点短,有些地方我还没来得及细看,下次再测一次应该能看得更全。",
  "刚才这盘收得有点快,有几处我还没摸透,不算是完整看过你。",
  "这局没走到我想看的最后一步,权当是个初步印象吧。",
];

export function pickIncompleteNote() {
  return INCOMPLETE_NOTE_LINES[Math.floor(Math.random() * INCOMPLETE_NOTE_LINES.length)];
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

// 每种类型再补一句"这一局专属"的引用——从这盘棋的原始信号(checkpoints/
// moves)里挑一个具体细节说出来,而不是不管哪局都能套用的空话。
// highlights 由 lib/skillProfile.js 的 computeSkillProfile 从 testState
// 派生,取不到对应细节时(比如那一关这局没触发)就返回 null,调用方
// 会自动退回到只说 TYPE_COMMENT 那句通用点评,不会拼出语法不通的句子。
function citationFor(typeKey, highlights) {
  if (!highlights) return null;
  const { defense: d, offense: o, global: g, calc: c, opening: op, adapt: ad, totalMoves } = highlights;

  switch (typeKey) {
    case "attack":
    case "attack_calc":
      if (o?.result === "hit" && o.turn) return `第 ${o.turn} 手你摆出双活三那下,我是真被将了一军。`;
      if (o?.result === "partial" && o.turn) return `第 ${o.turn} 手你抓到了一个活三,只是没扩成真正的杀棋,再往前一步就更好看了。`;
      return null;
    case "defense":
    case "defense_adapt":
      if (d?.result === "hit" && d.turn) return `第 ${d.turn} 手我逼你应招的时候,你接的就是最稳的那个点,几乎没犹豫。`;
      if (d?.result === "partial" && d.turn) return `第 ${d.turn} 手你把我挡住了,不算最干净,但顶住了。`;
      return null;
    case "vision":
    case "vision_opening":
      if (g?.result === "hit" && g.turn) return `第 ${g.turn} 手棋盘上同时有两处热闹,你两头都算进去了。`;
      if (g?.result === "partial" && g.turn) return `第 ${g.turn} 手棋盘分了两处,你先顾住了近的这头。`;
      return null;
    case "calc":
      if (c && c.total >= 3) return `这一局 ${c.total} 步里有 ${c.near} 步都踩在当时最好的那个点上。`;
      return null;
    case "opening":
      if (op) return `开局那几手,你几乎每次都紧贴着自己已有的棋子往外扩,没有另起炉灶。`;
      return null;
    case "adapt":
      if (ad?.recovered) return `第 ${ad.missTurn} 手你被我趁虚而入,但没几步你就把节奏找回来了。`;
      return null;
    case "balanced":
      if (totalMoves) return `这一局正正经经下了 ${totalMoves} 手,没有哪一段是明显的短板。`;
      return null;
    default:
      return null;
  }
}

export function resultLine(typeKey, highlights) {
  const base = TYPE_COMMENT[typeKey] || TYPE_COMMENT.balanced;
  const citation = citationFor(typeKey, highlights);
  return citation ? `${base}${citation}` : base;
}

export const RESULT_CONTINUE_LABEL = "继续";

// ============================================================
// 每日试炼:林墨作为固定 NPC 陪练时的台词。跟上面棋力测试那套台词
// 语气一致(自然、克制),但场合不一样——不是"考官在观察你",是
// "每天都会遇到的对手",所以更多体现"熟悉感"和"较量本身"。
// ============================================================

// 挑战前的招呼语,按连胜/连败状态给不同语气——这个语气变化本身就是
// 一种"林墨在跟着你的状态走"的反馈,而不是每天点开都是同一句话。
// 这一条专给"老朋友重逢"场景用(games_played > 0),第一次在每日试炼
// 遇到林墨走的是下面 dailyFirstMeetingInviteLine,两者不共用。
export function dailyReturnGreetingLine(streak) {
  if (streak >= 3) {
    const lines = [
      "你最近状态不错啊,今天还要继续?",
      "连着赢了好几回了,今天我可得认真点。",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  if (streak <= -2) {
    const lines = [
      "别急,输几局很正常,再来一盘。",
      "上次那盘是有点可惜,今天找回来?",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
  const lines = [
    "来了?棋盘我都摆好了。",
    "今天也来下一局?",
    "正好,我也想活动一下手腕。",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

// 兼容旧命名
export const dailyGreetingLine = dailyReturnGreetingLine;

// 第一次在"每日试炼"里遇到林墨(games_played === 0,不管之前有没有做过
// 棋力测试,那是另一个场合)——要体现"我们认识,但还没正经交过手"这个
// 关系上的细微差别,不能跟"老朋友重逢"用同一套话术。
export const DAILY_FIRST_MEETING_LINES = [
  "棋力测试那盘不算真的交手——今天要不要正经下一局?",
  "早想跟你正经下一盘了,今天有空?",
  "咱们还没真刀真枪下过一局呢,来试试?",
];
export function dailyFirstMeetingInviteLine() {
  return DAILY_FIRST_MEETING_LINES[Math.floor(Math.random() * DAILY_FIRST_MEETING_LINES.length)];
}

// 日常闲聊——跟棋盘无关,纯粹让林墨显得像个有生活的人,而不是只会
// 讲棋的对弈机器。邀请语之外附加展示的"第二句话"用这个池子,随机挑
// 一条,不是每次都说同一句。
export const DAILY_SMALL_TALK_LINES = [
  "刚才路过巷口,那家面馆又在排队了。",
  "今天棋院来了个新面孔,坐了一下午没走。",
  "外面天挺好,下完这局你也该出去走走。",
  "刚泡了壶茶,你要是不急,下完再聊两句。",
  "窗边那盆兰花,这两天总算开了。",
];
export function pickSmallTalkLine() {
  return DAILY_SMALL_TALK_LINES[Math.floor(Math.random() * DAILY_SMALL_TALK_LINES.length)];
}

export const DAILY_ACCEPT_LABEL = "好,来一局";
export const DAILY_DECLINE_LABEL = "改天吧";

// 玩家拒绝了林墨的邀请:不失落、不追问,给个体面的收尾。
export const DAILY_PLAYER_DECLINE_RESPONSE_LINES = [
  "行,那就改天。",
  "没事,棋院一直都在。",
  "好,那我先忙别的了。",
];
export function dailyPlayerDeclinedResponseLine() {
  return DAILY_PLAYER_DECLINE_RESPONSE_LINES[Math.floor(Math.random() * DAILY_PLAYER_DECLINE_RESPONSE_LINES.length)];
}

export const DAILY_CHALLENGE_LABEL = "挑战林墨";
export const DAILY_NO_STAMINA_LINE = "今天的体力好像不够了,明天再来吧。";

export const DAILY_WIN_LINES = [
  "这局我认了,你下得比我好。",
  "嗯,这盘是你的。",
  "被你赢了,下一局我不会这么松懈。",
];
export const DAILY_LOSE_LINES = [
  "这局算我的,别灰心,再来一盘就找回来了。",
  "刚才那几步你有点急,不然结果不一定是这样。",
  "赢是赢了,不过你后面追得挺紧的。",
];
export const DAILY_DRAW_LINES = [
  "打平了,谁都没让谁。",
  "这盘算平局,下一局见分晓。",
];

export function dailyResultLine(result) {
  const pool = result === "win" ? DAILY_WIN_LINES : result === "lose" ? DAILY_LOSE_LINES : DAILY_DRAW_LINES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- 赛后:林墨主动邀请 / 不主动邀请下一局 ----
export const DAILY_REMATCH_INVITE_LINES = [
  "要不要再来一局?我还没尽兴。",
  "时间还早,再战一盘?",
  "这盘不算完,再来一局找回场子?",
];
export function dailyRematchInviteLine() {
  return DAILY_REMATCH_INVITE_LINES[Math.floor(Math.random() * DAILY_REMATCH_INVITE_LINES.length)];
}
export const DAILY_REMATCH_ACCEPT_LABEL = "好啊,再来一局";
export const DAILY_REMATCH_DECLINE_LABEL = "今天先到这吧";

// 林墨这次没主动邀请(不是冷场,只是恰好没提)——给一句中性的收尾,
// 顺势把主动权交给玩家(玩家这边有"邀请TA"这个按钮)。
export const DAILY_NO_REMATCH_OFFER_LINES = [
  "今天先这样,你随时可以再来找我。",
  "下次想下了,来棋院找我就行。",
  "这盘先到这,我这边不勉强。",
];
export function dailyNoRematchOfferLine() {
  return DAILY_NO_REMATCH_OFFER_LINES[Math.floor(Math.random() * DAILY_NO_REMATCH_OFFER_LINES.length)];
}

export const DAILY_INVITE_NPC_LABEL = "邀请TA再来一局";
export const DAILY_PICK_OTHER_LABEL = "看看其他棋手";

// 玩家主动邀请,林墨接受
export const DAILY_ACCEPT_PLAYER_INVITE_LINES = [
  "行,那就再来一局。",
  "好,奉陪到底。",
  "正合我意。",
];
export function dailyAcceptPlayerInviteLine() {
  return DAILY_ACCEPT_PLAYER_INVITE_LINES[Math.floor(Math.random() * DAILY_ACCEPT_PLAYER_INVITE_LINES.length)];
}

// 玩家主动邀请,林墨拒绝——一定要给理由,且理由要"不冷场"(暗示下次
// 还会见面,不是真的在回避玩家)。
export const DAILY_PLAYER_INVITE_DECLINE_REASONS = [
  "有点累了,让我歇会儿,下次再战。",
  "我这边还有点事,晚点再说吧。",
  "刚才那盘让我想了不少,先消化消化。",
  "棋院这会儿有点吵,改天找个清静的时候再下。",
];
export function dailyPlayerInviteDeclineReason() {
  return DAILY_PLAYER_INVITE_DECLINE_REASONS[Math.floor(Math.random() * DAILY_PLAYER_INVITE_DECLINE_REASONS.length)];
}

// 体力耗尽,没法再邀请下一局了
export const DAILY_STAMINA_EXHAUSTED_LINES = [
  "今天下得也不少了,养足精神明天再来。",
  "先歇歇吧,明天棋盘还在。",
];
export function dailyStaminaExhaustedLine() {
  return DAILY_STAMINA_EXHAUSTED_LINES[Math.floor(Math.random() * DAILY_STAMINA_EXHAUSTED_LINES.length)];
}

// "选择下一步"页面(换个对手 / 返回首页)顶部的过渡语
export const DAILY_CHOOSE_NEXT_LINES = [
  "要不再找别的棋手练练?",
  "棋院里应该还有别人在。",
];
export function dailyChooseNextLine() {
  return DAILY_CHOOSE_NEXT_LINES[Math.floor(Math.random() * DAILY_CHOOSE_NEXT_LINES.length)];
}
export const DAILY_MATCH_NEXT_LABEL = "匹配下一位棋手";
export const DAILY_BACK_HOME_LABEL = "返回首页";
