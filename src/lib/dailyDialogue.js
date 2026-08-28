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
//
// 小七的语气写作原则(对齐角色设定文档):轻快、直接、带一点调皮,情绪
// 起伏明显,输赢都写在脸上——跟林墨的克制、苏晴的沉稳刻意拉开距离。
// 常用感叹号、"呀""啦""嘿嘿"这类语气词,喜欢用反问/感叹表达惊讶
// ("居然真的被你抓到了!"),但要注意分寸:活泼不等于幼稚或撒娇卖萌,
// 台词里体现的是"对下棋这件事真心觉得好玩"的少年感,不是单纯的可爱人设。

// 同一个池子不连续抽到重复的那一条——用池子数组本身当 key 存"上次抽的
// 下标",不需要调用方额外传状态。只解决"连续两次一样"这一种最扎眼的
// 重复,不做完整的"洗牌不放回",因为台词池会跟局势分类走,做太重的
// 防重复反而会在候选很少的分类里显得刻意。
const lastPickIndex = new WeakMap();
function pickLine(pool) {
  if (!pool || !pool.length) return null;
  if (pool.length === 1) return pool[0];
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === lastPickIndex.get(pool)) {
    idx = (idx + 1) % pool.length;
  }
  lastPickIndex.set(pool, idx);
  return pool[idx];
}

function pickFrom(pools, npcId) {
  const pool = pools[npcId] || pools.linmo;
  return pickLine(pool);
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
  xiaoqi: [
    "哎,你是新来的吧?要不要跟我下一局,我保证很好玩!",
    "听说棋院来了个新面孔——我可等不及要会会你了!",
    "早就想找人下棋了,你看起来挺有意思的,来一局?",
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
  xiaoqi: {
    win: ["你最近是不是开挂了?这么能赢!今天我可要认真起来了。", "连续这么多把赢我,我不服,再来!"],
    lose: ["哎呀别沮丧啦,运气总会转的,再来一局!", "怎么老是你输呀,来,我陪你多下几局找找感觉!"],
    neutral: ["哟,你来啦!棋盘我都摆好啦~", "又来啦?走走走,开始咯!", "来啦来啦,今天想怎么下?"],
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
  xiaoqi: [
    "刚才路上捡到一颗好看的小石头,你看看像不像棋子!",
    "我刚才试了个新招法,感觉超酷,等会儿说不定用得上哦。",
    "棋院今天的阳光特别好,晒得我都想睡觉了。",
    "巷口新开了家甜品店,下完棋要不要一起去看看?",
    "刚才看到只猫在棋院门口打盹,超可爱的。",
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
  xiaoqi: ["好吧好吧,那下次可别放我鸽子!", "嗯~那我去找别人玩喽!", "没事没事,我先去练练招法!"],
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
  xiaoqi: {
    win: ["啊?居然真的被你抓到了!算你厉害!", "这盘我输得心服口服,你那步棋我完全没想到!", "哇哦,被将了一军,下次我可不会这么大意了!"],
    lose: ["嘿嘿,这一步是不是没想到?", "赢啦赢啦!不过你后面追得挺紧的,吓我一跳!", "这局归我啦,不过你真的越来越强了!"],
    draw: ["打平啦?那就当我们俩都很厉害吧!", "平局也不错嘛,下一把见真章!"],
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
  xiaoqi: ["再来一局嘛!我还没尽兴呢!", "等一下,我要重新研究一下你的套路!再来一盘?", "不行不行,这盘不算,再来!"],
};
export function dailyRematchInviteLine(npcId) {
  return pickFrom(REMATCH_INVITE_LINES, npcId);
}

// ---- 赛后:NPC 没主动邀请,中性收尾,把主动权交给玩家 ----
const NO_REMATCH_OFFER_LINES = {
  linmo: ["今天先这样,你随时可以再来找我。", "下次想下了,来棋院找我就行。", "这盘先到这,我这边不勉强。"],
  suqing: ["今天先这样,想下的时候来找我就好。", "这盘先到这里,我不勉强你。", "先歇一下也好,下次想下了再来。"],
  xiaoqi: ["今天先这样啦,想我了就来找我!", "好啦,下次继续来挑战我吧,先撤了!", "先歇会儿,下次再战!"],
};
export function dailyNoRematchOfferLine(npcId) {
  return pickFrom(NO_REMATCH_OFFER_LINES, npcId);
}

// ---- 玩家主动邀请,NPC 接受 ----
const ACCEPT_PLAYER_INVITE_LINES = {
  linmo: ["行,那就再来一局。", "好,奉陪到底。", "正合我意。"],
  suqing: ["好,那就再来一局。", "可以,我也还没尽兴。", "好啊,正好再看看你。"],
  xiaoqi: ["好呀好呀,我求之不得!", "来就来,我可不会手软!", "正合我意,开始吧!"],
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
  xiaoqi: [
    "我脑子转不动了,让我歇会儿~",
    "我去研究一下新招法,晚点找你!",
    "棋院有点吵,我想找个安静地方冷静一下!",
    "我先去忙点别的,一会儿来找你!",
  ],
};
export function dailyPlayerInviteDeclineReason(npcId) {
  return pickFrom(PLAYER_INVITE_DECLINE_REASONS, npcId);
}

// ---- 体力耗尽,没法再邀请下一局 ----
const STAMINA_EXHAUSTED_LINES = {
  linmo: ["今天下得也不少了,养足精神明天再来。", "先歇歇吧,明天棋盘还在。"],
  suqing: ["今天下得也不少了,先歇着,明天再说。", "先到这里吧,养好精神明天再来。"],
  xiaoqi: ["今天下太多啦,我先去休息啦,明天见!", "体力耗光啦,明天再战哦!"],
};
export function dailyStaminaExhaustedLine(npcId) {
  return pickFrom(STAMINA_EXHAUSTED_LINES, npcId);
}

// ---- "选择下一步"页面顶部的过渡语(换个对手 / 返回首页) ----
const CHOOSE_NEXT_LINES = {
  linmo: ["要不再找别的棋手练练?", "棋院里应该还有别人在。"],
  suqing: ["要不再找别的棋手试试?", "棋院里应该还有人在。"],
  xiaoqi: ["要不去找别人玩玩?我等你回来哦!", "棋院里还有别人呢,去看看?"],
};
export function dailyChooseNextLine(npcId) {
  return pickFrom(CHOOSE_NEXT_LINES, npcId);
}

// ---- 对局开场白(进入 DailyTrialGameScreen 那一刻的第一句话) ----
const GAME_START_LINES = {
  linmo: ["你先来吧,我看看。", "开始了,你随意。", "第一步,你来。"],
  suqing: ["你先来吧,我看看你的棋路。", "开始了,你随意。", "第一步,你来就好。"],
  xiaoqi: ["准备好了吗?我可是不会轻易放水的哦!", "来吧来吧,你先手,我等着!", "开始咯,让我看看你的实力!"],
};
export function dailyGameStartLine(npcId) {
  return pickFrom(GAME_START_LINES, npcId);
}

// ---- 对局过程中的闲聊台词——不跟关卡触发挂钩,纯粹营造"对面坐着一个
// 会说话的人"的氛围,每走完一步有几率(不是每次都换)换一句场面话。
// 苏晴这一组要体现她"观察、随口点出局面"的说话习惯,句式上多用
// "我觉得……""其实……""刚才那里……""如果换一种思路……"。小七这一组
// 要体现她的直觉型打法和外放情绪——喜欢提醒(带调皮语气)、喜欢感叹
// 局面有趣,不做"这里正确/错误"式的冷静点评。 ----
// 局势分类台词——跟 dailyTrialEngine.js 的 classifyMoveSituation 一一
// 对应,四个 key(danger/attack/complex/neutral)必须跟那边返回的字符串
// 完全一致。之前这里是每个 NPC 一大桶随机抽,现在拆成"这一步实际是
// 什么性质"再对应着说,保证台词内容跟棋盘上真实发生的事情对得上——
// 比如小七说"这一步很危险哦"必须是她刚刚真的在化解一个大威胁,不能是
// 随手抽到的。
const AMBIENT_LINES = {
  linmo: {
    danger: ["这一步,你留了个破绽,我接住了。", "这里必须防,不然你下一步就要糟。", "刚才那手有点冒险,幸好我看到了。"],
    attack: ["我下这里,直接施压。", "这一步,该你头疼了。", "主动权,我拿回来了。"],
    complex: ["棋盘上不止一处,你留意一下。", "局面开始复杂了,别只看着这一块。", "两边都有威胁,得算清楚。"],
    neutral: ["这边,我随手落一子。", "嗯,该你了。", "轮到你了。"],
  },
  suqing: {
    danger: ["刚才那步其实挺危险的,我拦下来了。", "这里我不能不防,你逼得挺紧。", "好险,差一点就让你冲出去了。"],
    attack: ["这一步我想了一会儿,应该能给你点压力。", "我在这边落了一子,你留意一下。", "这步棋,我觉得值得走。"],
    complex: ["局面开始交织在一起了,得仔细算。", "两边都有点意思,不急着下结论。", "这盘棋,越下越有嚼头。"],
    neutral: ["我觉得你这一步在犹豫。", "其实这边还有别的路。", "如果换一种思路,可能会不一样。"],
  },
  xiaoqi: {
    danger: ["等等,这一步很危险哦,差点被你冲过去!", "这里必须挡,不然我就危险啦!", "好险好险,你这手我可不能不接!"],
    attack: ["嘿嘿,我发现一个有趣的点!", "我要下这里啦,看好咯!", "这一手,应该能让你紧张一下!"],
    complex: ["这局势越来越好玩了!", "复杂点才有意思嘛!", "两边缠在一起,超刺激的!"],
    neutral: ["你这步我没想到,厉害!", "嗯~让我想想接下来怎么走。", "棋盘上还有好多可能性呢!"],
  },
};
export function pickDailyAmbientLine(npcId, situation = "neutral") {
  const npcPools = AMBIENT_LINES[npcId] || AMBIENT_LINES.linmo;
  const pool = npcPools[situation] || npcPools.neutral;
  return pickLine(pool);
}
