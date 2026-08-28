// 每日试炼(林墨)自适应引擎
// ------------------------------------------------------------
// 跟 skillTest.js 那套"考官式"引擎的目的不一样:棋力测试是为了摸底,
// 每日试炼是要让玩家每天都愿意回来再打一局。这里的核心设计目标不是
// "让林墨下得多强",而是"让玩家始终处在想再来一局的那个状态"——
// 落地成三条具体机制,都在下面能找到对应的函数:
//
// 1. 心流通道(Flow Channel):林墨的强度不是固定的,是跟着玩家的
//    隐藏分(daily_trial_rating)走的——玩家越强,林墨也越强,始终让
//    这一局"够呛但不至于没希望"。两个人的分数都存在 profiles 表里,
//    每局结束后由服务器端的 finish_daily_trial 函数更新(见 schema.sql),
//    这个文件只负责"给定当前两边的分数,这一步该怎么下"。
// 2. 橡皮筋(Rubber-band):同一局棋内部,如果玩家局面明显占优,
//    强度会往上提一点,避免"AI看起来很笨"拆穿这套系统;如果玩家
//    局面明显落后,强度往下压一点,给一次"看起来还能翻盘"的喘息——
//    但这一切都只发生在"选点的宽窄/前瞻深度"这个层面,必杀/必防
//    永远不受影响(见 getAdaptiveMove 里对 findForcedMove 的处理),
//    不然容易出现"AI放着必杀棋不下"这种一眼假、砸招牌的情况。
// 3. 连胜/连败保护:连胜到一定场次,难度额外上调一截(避免"一路平推"
//    变得无聊);连败到一定场次,难度额外下调一截(避免连续受挫导致
//    当天直接弃疗、明天也不想再来)。
//
// 落子本身不重新发明轮子——candidateMoves/评分/三档选点这些底层原语
// 全部复用 game/ai.js 里已经写好、跑过实战的那一套,这里只是在"选哪个
// 强度区间的算法"这一层做连续化 + 动态化。
import { BLACK, WHITE, cloneBoard } from "./logic";
import {
  scoreCandidates,
  findForcedMove,
  findThreatPool,
  bestScoreFor,
  generalPool,
  weightedRandomPick,
  countLiveThreeThreats,
  SCORE,
} from "./ai";

// ---- 棋风人格 ----
// dial 只负责"这一步该有多强"(见下面 computeSkillDial),人格负责
// "同样的强度下,这位棋手会怎么选、怎么表达"——两件事分开管,人格
// 不能改变整体难度曲线,只改变候选点之间的取舍偏好。四个维度只作用在
// 候选点排序/加权这一层,绝不触碰 findForcedMove / findThreatPool 这两层
// ——必杀/必防的判定和候选池收窄是可信度的底线,人格化不能有任何机会
// 让它们失灵,道理跟文件头注释第 2 条讲的"橡皮筋不碰必杀必防"完全一致。
//
//   aggression:进攻分的权重,<1 表示不会为了抢攻硬冲
//   caution:防守分的权重,以及"这步棋会让对手拿到双威胁"这类致命失误的
//     惩罚力度,>1 表示更不愿意留下破绽
//   precision:算到对手最优回应时倒扣的力度,>1 表示更在意"这步棋会不会
//     给对手留反击的余地",对应"精准收官、减少风险"
//   patience:候选点加权随机时的"锐利度"——同样的分差,patience 越高,
//     被选中的概率差距会被放大得越明显,选择更集中、更少出人意料的跳跃
//
// 林墨保持 (1,1,1,1),也就是这一整层对他完全没有作用——这是为了不让
// 已经调好、跑过实战的林墨手感因为"给苏晴/小七加人格"这件事被连带改动。
const NPC_PERSONALITY = {
  linmo: { aggression: 1, caution: 1, precision: 1, patience: 1 },
  // 数值来自苏晴的角色设定文档(防守能力85 / 攻击欲望60 / 计算深度75 /
  // 风险偏好35 / 耐心程度95)——这里不是照抄百分比,那些数字是给人看的
  // 角色调性,换算成"相对林墨更偏向哪边"的乘数才是引擎真正用得上的东西。
  suqing: { aggression: 0.82, caution: 1.22, precision: 1.15, patience: 1.4 },
  // 数值来自小七的角色设定文档(攻击欲望85 / 防守意识45 / 冒险程度80 /
  // 计算深度65 / 耐心程度40,核心是"灵感攻击型"——同样换算成相对倍数:
  //   aggression 明显 >1:攻击欲望和冒险程度都是全场最高,主动抢攻;
  //   caution 明显 <1:防守意识最低,符合设定弱点"过度攻击、忽略防守";
  //   precision 略 <1:计算深度中等(65,低于苏晴的75),她"计算之后更
  //     相信直觉",不像苏晴那样把对手最优回应算得那么细;
  //   patience 明显 <1:耐心程度全场最低(40),对应候选点权重的"锐利度"
  //     调低,选点更容易出现她设定里说的"看起来奇怪但最后正确"的跳跃感。
  xiaoqi: { aggression: 1.35, caution: 0.75, precision: 0.85, patience: 0.55 },
};
function getPersonality(npcId) {
  return NPC_PERSONALITY[npcId] || NPC_PERSONALITY.linmo;
}

// 候选点的"人格化基础分"——原来三档共用的 Math.max(c.attack, c.defend)
// 现在按人格给进攻分/防守分分别加权再取更大的那个,林墨的两个权重都是 1,
// 结果跟原来完全一样。
function styledBase(c, personality) {
  return Math.max(c.attack * personality.aggression, c.defend * personality.caution);
}

// ---- 读懂对手棋风、动态调整(苏晴 / 小七专属)----
// "洞察调整型"是苏晴的核心设定——面对进攻型玩家,她会避免正面对抗,
// 利用防守找反击机会;面对偏保守的玩家,她会慢慢加压,逼玩家主动求变。
// 小七的设定文档里也有对应的一条弱点("缺乏耐心——面对防守型玩家,
// 容易主动制造变化"),同一套机制拿来复用,只是反应幅度按各自人设
// 分开配:小七"学习能力"高但耐心低,遇到保守玩家会比苏晴压得更猛、
// 更快失去耐心;遇到进攻型玩家,她的设定里没有苏晴那种"主动转为防守
// 打反击"的倾向,只做很轻的收敛,不会整体变保守。
// 林墨是"计算压制型",整局强度只跟 dial 走,不会因为读出玩家风格而
// 临场变调,所以他不在下面这张表里,原样返回人格参数、不做任何改动
// ——以后再加不需要这层临场调整的新棋手,同样不用配这张表。
const STYLE_REACTIONS = {
  suqing: {
    // 玩家偏进攻:避免正面对抗,把权重进一步压向防守,等对手自己
    // 露出破绽再反击——对应"利用防守寻找反击机会"。
    offensive: { aggression: 0.85, caution: 1.12 },
    // 玩家偏保守:慢慢加压,逼玩家主动变化——对应
    // "扩大优势区域,逼迫玩家主动变化"。
    defensive: { aggression: 1.15, caution: 0.92 },
  },
  xiaoqi: {
    // 玩家偏进攻:她不会像苏晴那样转向防守打反击,只是稍微收一点,
    // 避免在对攻里因为防守意识本来就低而被punish得太狠。
    offensive: { aggression: 0.95, caution: 1.08 },
    // 玩家偏保守:耐心全场最低,面对慢节奏玩家会更快主动搅局、
    // 加压幅度比苏晴更大——对应设定文档"缺乏耐心"这条弱点。
    defensive: { aggression: 1.25, caution: 0.85 },
  },
};
//
// 判断依据很朴素:玩家每一步落子前,比较那个点当时的进攻分和防守分——
// 明显偏进攻分的算一次"进攻倾向",明显偏防守分的算一次"防守倾向"。
// 样本数不够(刚开局没几手)时不下结论,避免见面没多久就误判。
export function createOpponentStyleState() {
  return { offensive: 0, defensive: 0, total: 0 };
}

// 要在"玩家落子被应用到棋盘之前"调用,原因跟 recordPlayerMove 一样——
// scoreCandidates 要算的是玩家落子前那一刻真正面对的局面。
export function recordPlayerStyleSignal(styleState, boardBeforeMove, x, y, playerColor, opponentColor) {
  if (!styleState) return;
  const scored = scoreCandidates(boardBeforeMove, playerColor, opponentColor);
  const chosen = scored.find((c) => c.x === x && c.y === y);
  if (!chosen) return;
  styleState.total += 1;
  if (chosen.attack > chosen.defend * 1.15) {
    styleState.offensive += 1;
  } else if (chosen.defend > chosen.attack * 1.15) {
    styleState.defensive += 1;
  }
}

const STYLE_READING_MIN_SAMPLES = 4; // 样本太少时不调整,等看够几步再下结论

function applyOpponentStyleReading(personality, npcId, styleState) {
  const reactions = STYLE_REACTIONS[npcId];
  if (!reactions || !styleState || styleState.total < STYLE_READING_MIN_SAMPLES) {
    return personality;
  }
  const offensiveRatio = styleState.offensive / styleState.total;
  if (offensiveRatio >= 0.55) {
    const { aggression, caution } = reactions.offensive;
    return {
      ...personality,
      aggression: personality.aggression * aggression,
      caution: personality.caution * caution,
    };
  }
  const defensiveRatio = styleState.defensive / styleState.total;
  if (defensiveRatio >= 0.55) {
    const { aggression, caution } = reactions.defensive;
    return {
      ...personality,
      aggression: personality.aggression * aggression,
      caution: personality.caution * caution,
    };
  }
  return personality;
}

export const PLAYER_COLOR = BLACK; // 每日试炼里玩家固定执黑先手,跟棋力测试保持一致的体验
export const LINMO_COLOR = WHITE;

export const STAMINA_COST = 5;
export const DAILY_STAMINA_CAP = 20;

// 注:棋力测试隐藏分 -> 每日试炼初始评分的"冷启动"逻辑,现在完全由
// 服务器端负责(见 supabase/schema.sql 的 sync_daily_trial_rating_from_skill_test
// 触发器,在 skill_test_status 变成 completed 时把 daily_trial_rating /
// linmo_rating 一起同步)。这里原来有一份客户端镜像版本
// (computeInitialRating + DEFAULT_RATING),写完之后从没被任何地方
// 调用过——评分的权威来源必须只有一个,两边各算一遍是风险不是保险,
// 所以删掉了,不要再加回来。

function clampDial(v) {
  return Math.max(5, Math.min(85, v)); // 上限从 97 降到 85——玩家默认有一点基础,
  // 顶格的对抗强度要给强玩家留一点找破绽的空间,不搞到几乎不可能翻盘
}

// 软启动:每日试炼里跟某位 NPC 打的头几局,不管评分差距算出来多大,
// 强度都封顶在一个温和区间——玩家有基础不等于一上来就该扛住评分系统
// 刚收敛前(比如棋力测试分偏高)可能出现的偏难开局体验,给几局适应期。
export const SOFT_START_GAMES = 3;
export const SOFT_START_DIAL_CAP = 60;

// 基础强度旋钮(0-100 的连续值,不是三档):由"林墨分 - 玩家分"的差距
// 决定——林墨比玩家强得越多,旋钮越靠近 100(几乎不留情面);玩家比
// 林墨强,旋钮往下走,让玩家能感觉到自己在"赢一个和自己差不多强、
// 甚至更强的对手",而不是心知肚明在欺负一个杵在原地的木桩子。
function baseDial(playerRating, linmoRating) {
  return clampDial(50 + (linmoRating - playerRating) * 1.5);
}

// 连胜/连败修正:见文件头注释第 3 条。
// 之前这里两头各有一个硬顶(+10 / -14),本意是"别一下调太猛,保留渐进感",
// 但实测发现连败保护顶到 -14 之后,如果 base(评分差决定的基础强度)
// 本来就在 50 附近(比如刚做完棋力测试、双方分数打平的新玩家),
// 50-14=36 还是压不过中/低档的分界线(35)——连败越打越久,强度却
// 从第 5 场开始就不再往下松了,体验上就是"系统看着在放水,但松得
// 不够",十连败也翻不了身。改成不设硬顶,让 base 自身的 5-85 区间
// 和外层 clampDial 兜底就够了,连败拖得越久,这里给的缓冲也持续
// 跟着往下探,而不是拖到某个场次就停手不管。
function streakAdjustment(streak) {
  if (streak >= 3) return (streak - 2) * 3; // 连胜越久,加得越多
  if (streak <= -2) return (streak + 1) * 4; // 连败越久,减得越多
  return 0;
}

// 单局内的实时"橡皮筋"修正:见文件头注释第 2 条。用双方当前各自的
// 最优落点分数粗略估计"这个局面对谁更有利",不追求精确,只要方向对、
// 幅度克制就够了——这只是节奏调节,不是决定胜负的核心逻辑。
function flowAdjustment(board, aiColor, humanColor) {
  const aiBest = bestScoreFor(board, aiColor, humanColor);
  const humanBest = bestScoreFor(board, humanColor, aiColor);
  const diff = humanBest - aiBest; // 玩家能拿到的最高分明显更高 -> 玩家局面占优
  if (diff > SCORE.LIVE_THREE) return 8; // 玩家明显占优,林墨绷紧一点
  if (diff < -SCORE.LIVE_THREE) return -6; // 林墨明显占优,松一点,别一路平推到底
  return 0;
}

// 人格强度补偿:文件头第一段说"人格不改变整体难度曲线,只改变候选点
// 之间的取舍偏好",但 precision/caution/patience 这三个维度实测并不
// 满足这句话——precision/caution 越高,同一个候选池里就越会避开容易
// 被针对的选点;patience 越高,pickByDialLow/Mid 里加权随机的"锐利度"
// 越高,越不容易随机选到次优点、被玩家抓住空子(pickByDialHigh 已经是
// 零随机的确定性最优解,patience 在那一档不起作用,所以这个补偿主要
// 在低/中档起效,跟"低/中档才有随机性"这件事正好对上)。
// 这几条叠加起来,会让同样 dial 数值下不同人格的棋手实际强度不一样——
// 苏晴现在的三个数值(precision 1.15 / caution 1.22 / patience 1.4)会让
// 她比系统以为的更难缠,而 daily_trial_rating/streak 这套自适应系统对
// 这件事一无所知,压根不会去补偿。
// 这里给每个人格算一个"强度补偿值",从最终 dial 里扣掉,把这部分隐性
// 强度折算回去,让"人格不改变整体难度曲线"这句设计意图真正成立——
// 补偿之后,同样的评分差距/连胜连败,不同棋手应该玩起来难度相近,
// 人格差异只体现在"棋风"(比如苏晴更倾向防守、更少见随手棋),不体现
// 在"赢不赢得了"上。aggression 没算进来,是因为它更偏"style"而非
// "strength"——偏进攻还是偏防守本身不构成谁更难赢,只有会让 AI 整体
// 更接近"理论最优"的这三条才算强度。
// 系数是估算出来的,没有做过大量对局的胜率回归;以后如果实测发现某个
// 人格明显偏难/偏简单,先调这里的系数,不要动 baseDial / streakAdjustment
// ——这样"评分系统怎么看待强度差距"和"人格怎么让人觉得难缠"两件事
// 才能继续分开调,不互相牵连。
function personalityDialOffset(personality) {
  const raw =
    (personality.precision - 1) * 8 +
    (personality.caution - 1) * 6 +
    (personality.patience - 1) * 12;
  return Math.max(-20, Math.min(20, Math.round(raw)));
}

/**
 * 算出"这一步"该用的强度旋钮。之所以不是算一次用一整局,是因为
 * flowAdjustment 要跟着局面实时变——每次轮到林墨走之前都应该重新算。
 * npcId 用来查这位棋手的人格补偿值——不传(比如以后别的调用方懒得传)
 * 就按林墨算,补偿值天然是 0,行为跟原来完全一样。
 */
export function computeSkillDial({ playerRating, linmoRating, streak, board, aiColor = LINMO_COLOR, humanColor = PLAYER_COLOR, gamesPlayed = Infinity, npcId }) {
  const base = baseDial(playerRating, linmoRating);
  const offset = personalityDialOffset(getPersonality(npcId));
  const dial = clampDial(Math.round(base + streakAdjustment(streak) + flowAdjustment(board, aiColor, humanColor) - offset));
  if (gamesPlayed < SOFT_START_GAMES) {
    return Math.min(dial, SOFT_START_DIAL_CAP);
  }
  return dial;
}

// 简单档:纯静态评估 + 加权随机(跟 ai.js 的 pickEasy 等价,单独写一份
// 是因为这里 pool 已经在外层按 dial 连续算好了,不需要再依赖 ai.js
// 内部没导出的那个 pickEasy)
function pickByDialLow(pool, personality) {
  return weightedRandomPick(pool, (c) => Math.pow(Math.max(styledBase(c, personality), 1), personality.patience));
}

// 中档:1 层前瞻(倒扣对手最优回应)
function pickByDialMid(board, pool, aiPlayer, humanPlayer, personality) {
  const withLookahead = pool.map((c) => {
    const trial = cloneBoard(board);
    trial[c.y][c.x] = aiPlayer;
    const oppBest = bestScoreFor(trial, humanPlayer, aiPlayer);
    let finalScore = styledBase(c, personality) - oppBest * 0.9 * personality.precision;
    if (countLiveThreeThreats(trial, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 3 * personality.caution;
    }
    return { x: c.x, y: c.y, finalScore };
  });
  return weightedRandomPick(withLookahead, (c) => Math.pow(Math.max(c.finalScore, 1), personality.patience));
}

// 高档:2 层前瞻,零随机,直接选算出来最优的一手
function pickByDialHigh(board, pool, aiPlayer, humanPlayer, personality) {
  const topCandidates = [...pool]
    .sort((a, b) => styledBase(b, personality) - styledBase(a, personality))
    .slice(0, 8);

  let best = null;
  for (const c of topCandidates) {
    const board1 = cloneBoard(board);
    board1[c.y][c.x] = aiPlayer;
    let finalScore = styledBase(c, personality);

    const oppScored = scoreCandidates(board1, humanPlayer, aiPlayer);
    const oppForced = findForcedMove(oppScored);
    const oppMove = oppForced || oppScored.reduce(
      (b, x) => (!b || Math.max(x.attack, x.defend) > Math.max(b.attack, b.defend) ? x : b), null
    );
    if (oppMove) {
      const oppScore = Math.max(oppMove.attack, oppMove.defend);
      const board2 = cloneBoard(board1);
      board2[oppMove.y][oppMove.x] = humanPlayer;
      const aiFollowUp = bestScoreFor(board2, aiPlayer, humanPlayer);
      finalScore = finalScore - oppScore * 0.9 * personality.precision + aiFollowUp * 0.5;
    }
    if (countLiveThreeThreats(board1, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 8 * personality.caution;
    }
    if (!best || finalScore > best.finalScore) {
      best = { x: c.x, y: c.y, finalScore };
    }
  }
  return best;
}

/**
 * 给定连续强度旋钮 dial(0-100),算出这一步该下在哪。
 * 必杀/必防(findForcedMove)永远不受 dial、也不受人格影响——这是
 * 可信度的底线,不管旋钮多低、人格多保守,都不能对着一步就能赢/
 * 一步就会输的棋视而不见。
 *
 * npcId 决定用哪套人格(见 NPC_PERSONALITY),opponentStyle 是
 * createOpponentStyleState() 建的累计状态,只有苏晴会读它、动态微调
 * 人格参数(见 applyOpponentStyleReading)。两个参数都可以不传,不传
 * 时等价于原来的林墨专属行为,不影响任何既有调用方。
 */
export function getAdaptiveMove(board, aiPlayer, humanPlayer, dial, npcId = "linmo", opponentStyle = null) {
  const scored = scoreCandidates(board, aiPlayer, humanPlayer);
  if (!scored.length) return null;

  const forced = findForcedMove(scored);
  if (forced) return forced;

  const threatPool = findThreatPool(scored);
  const pool = threatPool || generalPool(scored, 0.42 + (dial / 100) * 0.38);

  const personality = applyOpponentStyleReading(getPersonality(npcId), npcId, opponentStyle);

  if (dial >= 70) return pickByDialHigh(board, pool, aiPlayer, humanPlayer, personality);
  if (dial >= 35) return pickByDialMid(board, pool, aiPlayer, humanPlayer, personality);
  return pickByDialLow(pool, personality);
}

// ---- 局势分类,给"对局中闲聊"用 ----
// 背景:之前闲聊台词是纯随机抽卡(Math.random() < 0.5 就抽一句),
// 完全不管这一步棋实际发生了什么——小七可能在一步毫无威胁的棋上说
// "这一步很危险哦",一眼就能看出是在瞎说,人设反而被拆穿。这个函数
// 把"这一步刚刚发生了什么"读出来,分成四类,台词库按类别配台词,
// 保证 NPC 说的话跟棋盘上真实发生的事情对得上:
//   "danger"  —— AI 这一步是在化解玩家的强威胁(defend 分数达到冲四
//                甚至更高的门槛,也就是玩家那手棋不接住下一步就要糟)
//   "attack"  —— AI 这一步自己走出了强攻(attack 分数达到冲四/活三
//                级别,主动权在她这边)
//   "complex" —— 都够不上以上两档的强度,但双方各自都还有至少一处
//                能长成活三的苗头,棋盘绞在一起,没有单方面明显的
//                主导方
//   "neutral" —— 以上都不满足,普通的一手
// 复用的都是 ai.js 里已经在用、经过实战验证的评分原语,不新增任何
// 独立的"是否危险"判定逻辑,避免闲聊台词的判断标准跟 AI 真正落子时
// 用的标准对不上、说一套下一套。
export function classifyMoveSituation(boardBeforeMove, move, aiPlayer, humanPlayer) {
  if (!move) return "neutral";
  const scored = scoreCandidates(boardBeforeMove, aiPlayer, humanPlayer);
  const picked = scored.find((c) => c.x === move.x && c.y === move.y);
  if (!picked) return "neutral";

  if (picked.defend >= SCORE.FOUR || picked.defend >= SCORE.LIVE_THREE) return "danger";
  if (picked.attack >= SCORE.FOUR || picked.attack >= SCORE.LIVE_THREE) return "attack";

  const boardAfter = cloneBoard(boardBeforeMove);
  boardAfter[move.y][move.x] = aiPlayer;
  const aiHasHeat = countLiveThreeThreats(boardAfter, aiPlayer, humanPlayer) >= 1;
  const humanHasHeat = countLiveThreeThreats(boardAfter, humanPlayer, aiPlayer) >= 1;
  if (aiHasHeat && humanHasHeat) return "complex";

  return "neutral";
}

// 首页展示体力用。profiles.stamina 这个字段只有玩家真的点开过一次
// 每日试炼(触发服务器那边的 ensure_daily_reset)才会被刷新成"今天该
// 有的样子"——如果玩家今天还没点开每日试炼,数据库里存的可能还是
// 昨天用剩的数字。首页只是让玩家瞟一眼,不值得为了这一个数字专门发
// 一次网络请求去刷新,所以在客户端用同一条"日期变了就当满体力"规则
// 兜底展示;等玩家真的点进每日试炼,服务器会做一次权威的、真正写库
// 的重置。两边判断逻辑必须一致,所以都用 UTC 自然日。
export function getDisplayStamina(stamina, staminaDate) {
  if (typeof stamina !== "number") return DAILY_STAMINA_CAP;
  if (!staminaDate) return stamina;
  const today = new Date().toISOString().slice(0, 10);
  return staminaDate === today ? stamina : DAILY_STAMINA_CAP;
}
// 见 App 层 DailyTrialScreen 的对话流程:一局结束后,可能是林墨主动
// 邀请玩家再战,也可能是玩家主动邀请林墨——两种邀请各自的"接受率"
// 分开设:
// - 林墨主动邀请的概率不能太高(不然每局结束都在问,显得聒噪),也不能
//   太低(不然玩家几乎永远等不到一次"主动邀请"带来的小惊喜),0.6 是
//   一个"多数时候会约你,但不是每次"的比例。
// - 玩家主动开口邀请时,林墨的接受率给得更高(0.8)——玩家都主动开口了,
//   如果频繁被拒会显得这个角色很难搞、打击玩家下次还想约的意愿;
//   剩下 20% 的拒绝不是要制造挫败感,只是让"他也是一个有自己安排的人"
//   这件事显得真实一点,拒绝时一定会给一个不冷场的理由(见
//   lib/dailyDialogue.js 的 dailyPlayerInviteDeclineReason)。
export const NPC_REMATCH_INVITE_RATE = 0.6;
export const NPC_ACCEPT_PLAYER_INVITE_RATE = 0.8;

export function rollNpcInvitesRematch() {
  return Math.random() < NPC_REMATCH_INVITE_RATE;
}

export function rollNpcAcceptsPlayerInvite() {
  return Math.random() < NPC_ACCEPT_PLAYER_INVITE_RATE;
}

// ---- 单局质量信号采集(赛后算 matchQuality 用,思路借鉴
//      lib/skillProfile.js 的"计算力"维度:玩家每一步实际选点跟当时
//      理论最高分之间的差距,差距越小说明这一局玩家发挥越稳) ----

export function createMoveLog() {
  return [];
}

// 要在"玩家落子被应用到棋盘之前"调用,这样 scoreCandidates 算出来的
// 才是玩家落子前那一刻真正面对的局面,不然 bestAvailable 会被自己刚
// 下的这一步污染。
export function recordPlayerMove(moveLog, boardBeforeMove, x, y, playerColor, opponentColor) {
  const scored = scoreCandidates(boardBeforeMove, playerColor, opponentColor);
  const bestAvailable = scored.length ? Math.max(...scored.map((c) => Math.max(c.attack, c.defend))) : 0;
  const chosen = scored.find((c) => c.x === x && c.y === y);
  const actual = chosen ? Math.max(chosen.attack, chosen.defend) : 0;
  moveLog.push({ bestAvailable, actual });
}

// 0-1 的一局质量分:每一步"实际选点/当时最优选点"的比值取平均。
// 没有可比较的步(比如整局只走了一两步就分出胜负)时返回中性值 0.5,
// 不让极端短局把玩家的隐藏分拉向某个极端。
export function computeMatchQuality(moveLog) {
  const relevant = moveLog.filter((m) => m.bestAvailable > 0);
  if (!relevant.length) return 0.5;
  const gaps = relevant.map((m) => Math.min(1, m.actual / m.bestAvailable));
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}
