// 每日试炼专用的台词模块——跟 lib/linmoDialogue.js(棋风测试专属,只有
// 林墨会用到)分开放,是因为每日试炼从设计上就是"随机匹配棋馆里的一位
// 棋手",台词必须按 npc.id 分开配一套,不能所有人共用同一种语气。
//
// 结构:每一类台词都是 { linmo: [...], suqing: [...] } 这样按 npc id 分桶
// 的对象,取词时用 pickFrom(pools, npcId) 统一兜底到 linmo 那一桶(理论上
// 不会触发,除非某个新 npc 忘了配台词,兜底比白屏/报错更安全)。
//
// 苏晴的语气写作原则(对齐角色设定文档):温和、自然、克制,体现"观察"
// 而不是"计算"——常用"我觉得……""其实……""刚才那里……""如果换一种
// 思路……"这类句式;不撒娇、不过度甜美、不用网络化用语,输赢都不失态。

function pickFrom(pools, npcId) {
  const pool = pools[npcId] || pools.linmo;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- 见面邀请:第一次在"每日试炼"里遇到这位棋手 ----
const FIRST_MEETING_LINES = {
  linmo: [
    "棋风测试那盘不算真的交手——今天要不要正经下一局?",
    "早想跟你正经下一盘了,今天有空?",
    "咱们还没真刀真枪下过一局呢,来试试?",
  ],
  suqing: [
    "听说你最近常来棋院,我倒还没正经跟你下过一局。",
    "刚才路过,看你和林墨下过一盘,棋风挺有意思——要不要也陪我一局?",
    "早想找你下一局了,一直没找到合适的时候,现在正好。",
  ],
};
export function dailyFirstMeetingInviteLine(npcId) {
  return pickFrom(FIRST_MEETING_LINES, npcId);
}

// ---- 见面邀请:老朋友重逢(games_played > 0),按连胜/连败给不同语气 ----
const RETURN_GREETING_LINES = {
  linmo: {
    win: ["你最近状态不错啊,今天还要继续?", "连着赢了好几回了,今天我可得认真点。"],
    lose: ["别急,输几局很正常,再来一盘。", "上次那盘是有点可惜,今天找回来?"],
    neutral: ["来了?棋盘我都摆好了。", "今天也来下一局?", "正好,我也想活动一下手腕。"],
  },
  suqing: {
    win: ["这几天你的状态我都看在眼里,今天还想继续?", "连着赢了不少,今天我得认真应对了。"],
    lose: ["输几局不是坏事,能看出问题在哪——要不要再来一局?", "上一局你后面有点急,今天不妨慢一点。"],
    neutral: ["来了,棋盘我摆好了。", "今天也想下一局?", "正好,我也想找个人说说话,顺便下一盘。"],
  },
};
export function dailyReturnGreetingLine(npcId, streak) {
  const pools = RETURN_GREETING_LINES[npcId] || RETURN_GREETING_LINES.linmo;
  const bucket = streak >= 3 ? pools.win : streak <= -2 ? pools.lose : pools.neutral;
  return bucket[Math.floor(Math.random() * bucket.length)];
}

// ---- 见面邀请附带的第二句闲聊,只在"老朋友重逢"时出现 ----
const SMALL_TALK_LINES = {
  linmo: [
    "刚才路过巷口,那家面馆又在排队了。",
    "今天棋院来了个新面孔,坐了一下午没走。",
    "外面天挺好,下完这局你也该出去走走。",
    "刚泡了壶茶,你要是不急,下完再聊两句。",
    "窗边那盆兰花,这两天总算开了。",
  ],
  suqing: [
    "刚才在整理棋谱,翻到一本很旧的手抄本,挺有意思。",
    "窗外那棵树,这几天叶子换了颜色。",
    "刚泡了茶,你要是不急,下完再坐一会儿。",
    "今天棋院比较安静,适合好好下一盘。",
    "路上看到几个小朋友在学棋,想起自己小时候。",
  ],
};
export function pickSmallTalkLine(npcId) {
  return pickFrom(SMALL_TALK_LINES, npcId);
}

// ---- 邀请/挑战通用按钮文案(不涉及人设语气,两位棋手共用) ----
export const DAILY_ACCEPT_LABEL = "好,来一局";
export const DAILY_DECLINE_LABEL = "改天吧";
export const DAILY_REMATCH_ACCEPT_LABEL = "好啊,再来一局";
export const DAILY_REMATCH_DECLINE_LABEL = "今天先到这吧";
export const DAILY_INVITE_NPC_LABEL = "邀请TA再来一局";
export const DAILY_PICK_OTHER_LABEL = "看看其他棋手";
export const DAILY_MATCH_NEXT_LABEL = "匹配下一位棋手";
export const DAILY_BACK_HOME_LABEL = "返回首页";

// ---- 玩家拒绝了邀请:不失落、不追问,体面收尾 ----
const PLAYER_DECLINE_RESPONSE_LINES = {
  linmo: ["行,那就改天。", "没事,棋院一直都在。", "好,那我先忙别的了。"],
  suqing: ["没关系,改天有空再说。", "好,那我就不打扰你了。", "行,那我自己再摆几手。"],
};
export function dailyPlayerDeclinedResponseLine(npcId) {
  return pickFrom(PLAYER_DECLINE_RESPONSE_LINES, npcId);
}

// ---- 对局结果点评:win/lose/draw 是站在玩家视角(win = 玩家赢) ----
const RESULT_LINES = {
  linmo: {
    win: ["这局我认了,你下得比我好。", "嗯,这盘是你的。", "被你赢了,下一局我不会这么松懈。"],
    lose: ["这局算我的,别灰心,再来一盘就找回来了。", "刚才那几步你有点急,不然结果不一定是这样。", "赢是赢了,不过你后面追得挺紧的。"],
    draw: ["打平了,谁都没让谁。", "这盘算平局,下一局见分晓。"],
  },
  suqing: {
    win: ["这局我棋差一着,你下得很稳。", "刚才那步我犹豫了一下,让你抓住了机会。", "这盘算你的,下次我会更留意一点。"],
    lose: ["这局是我赢了,不过你后面调整得很快。", "这盘算我的,你别在意,状态是会起伏的。", "赢是赢了,但你中间那几步其实很接近扳回来。"],
    draw: ["打平了,谁都没露出破绽。", "这盘算平局,下一局再看看。"],
  },
};
export function dailyResultLine(npcId, result) {
  const pools = RESULT_LINES[npcId] || RESULT_LINES.linmo;
  const bucket = result === "win" ? pools.win : result === "lose" ? pools.lose : pools.draw;
  return bucket[Math.floor(Math.random() * bucket.length)];
}

// ---- 赛后:NPC 主动邀请下一局 ----
const REMATCH_INVITE_LINES = {
  linmo: ["要不要再来一局?我还没尽兴。", "时间还早,再战一盘?", "这盘不算完,再来一局找回场子?"],
  suqing: ["要不要再下一局?我还想再看看你的棋。", "时间还早,再来一盘?", "这盘让我有点想法,想再验证一下,再来一局?"],
};
export function dailyRematchInviteLine(npcId) {
  return pickFrom(REMATCH_INVITE_LINES, npcId);
}

// ---- 赛后:NPC 没主动邀请,中性收尾,把主动权交给玩家 ----
const NO_REMATCH_OFFER_LINES = {
  linmo: ["今天先这样,你随时可以再来找我。", "下次想下了,来棋院找我就行。", "这盘先到这,我这边不勉强。"],
  suqing: ["今天先这样,想下的时候来找我就好。", "这盘先到这里,我不勉强你。", "先歇一下也好,下次想下了再来。"],
};
export function dailyNoRematchOfferLine(npcId) {
  return pickFrom(NO_REMATCH_OFFER_LINES, npcId);
}

// ---- 玩家主动邀请,NPC 接受 ----
const ACCEPT_PLAYER_INVITE_LINES = {
  linmo: ["行,那就再来一局。", "好,奉陪到底。", "正合我意。"],
  suqing: ["好,那就再来一局。", "可以,我也还没尽兴。", "好啊,正好再看看你。"],
};
export function dailyAcceptPlayerInviteLine(npcId) {
  return pickFrom(ACCEPT_PLAYER_INVITE_LINES, npcId);
}

// ---- 玩家主动邀请,NPC 拒绝——一定给一个不冷场的理由 ----
const PLAYER_INVITE_DECLINE_REASONS = {
  linmo: [
    "有点累了,让我歇会儿,下次再战。",
    "我这边还有点事,晚点再说吧。",
    "刚才那盘让我想了不少,先消化消化。",
    "棋院这会儿有点吵,改天找个清静的时候再下。",
  ],
  suqing: [
    "让我先想想刚才那盘,过会儿再下。",
    "有点累了,先歇一会儿,下次再战。",
    "棋院这会儿有点吵,想找个安静的时候再下。",
    "先去处理点别的事,晚点再找你。",
  ],
};
export function dailyPlayerInviteDeclineReason(npcId) {
  return pickFrom(PLAYER_INVITE_DECLINE_REASONS, npcId);
}

// ---- 体力耗尽,没法再邀请下一局 ----
const STAMINA_EXHAUSTED_LINES = {
  linmo: ["今天下得也不少了,养足精神明天再来。", "先歇歇吧,明天棋盘还在。"],
  suqing: ["今天下得也不少了,先歇着,明天再说。", "先到这里吧,养好精神明天再来。"],
};
export function dailyStaminaExhaustedLine(npcId) {
  return pickFrom(STAMINA_EXHAUSTED_LINES, npcId);
}

// ---- "选择下一步"页面顶部的过渡语(换个对手 / 返回首页) ----
const CHOOSE_NEXT_LINES = {
  linmo: ["要不再找别的棋手练练?", "棋院里应该还有别人在。"],
  suqing: ["要不再找别的棋手试试?", "棋院里应该还有人在。"],
};
export function dailyChooseNextLine(npcId) {
  return pickFrom(CHOOSE_NEXT_LINES, npcId);
}

// ---- 对局开场白(进入 DailyTrialGameScreen 那一刻的第一句话) ----
const GAME_START_LINES = {
  linmo: ["你先来吧,我看看。", "开始了,你随意。", "第一步,你来。"],
  suqing: ["你先来吧,我看看你的棋路。", "开始了,你随意。", "第一步,你来就好。"],
};
export function dailyGameStartLine(npcId) {
  return pickFrom(GAME_START_LINES, npcId);
}

// ---- 对局过程中的闲聊台词——不跟关卡触发挂钩,纯粹营造"对面坐着一个
// 会说话的人"的氛围,每走完一步有几率(不是每次都换)换一句场面话。
// 苏晴这一组要体现她"观察、随口点出局面"的说话习惯,句式上多用
// "我觉得……""其实……""刚才那里……""如果换一种思路……"。 ----
const AMBIENT_LINES = {
  linmo: [
    "这边,我随手落一子。",
    "嗯,该你了。",
    "我下这里,你看看。",
    "轮到你了。",
    "棋盘上不止一处,你留意一下。",
    "别只看着这一块。",
  ],
  suqing: [
    "我觉得你这一步在犹豫。",
    "其实这边还有别的路。",
    "刚才那里,你考虑了挺久。",
    "如果换一种思路,可能会不一样。",
    "嗯,我再看看你接下来怎么走。",
    "这一步,我多想了一会儿。",
  ],
};
export function pickDailyAmbientLine(npcId) {
  return pickFrom(AMBIENT_LINES, npcId);
}
