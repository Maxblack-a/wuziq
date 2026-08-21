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

export const PLAYER_COLOR = BLACK; // 每日试炼里玩家固定执黑先手,跟棋力测试保持一致的体验
export const LINMO_COLOR = WHITE;

export const STAMINA_COST = 5;
export const DAILY_STAMINA_CAP = 20;

export const RATING_MIN = 0;
export const RATING_MAX = 100;
export const DEFAULT_RATING = 50; // 没做过棋力测试时,双方都从中间值起步

// 棋力测试给的隐藏分是"冷启动锚点"——测过就用那个当起点(更准),
// 没测过/跳过了就用中性的 50 分,不因为没测过而给玩家一个不公平的
// 起始难度。
export function computeInitialRating(skillTestStatus, skillTestHiddenScore) {
  if (skillTestStatus === "completed" && typeof skillTestHiddenScore === "number") {
    return Math.max(RATING_MIN, Math.min(RATING_MAX, Math.round(skillTestHiddenScore)));
  }
  return DEFAULT_RATING;
}

function clampRating(v) {
  return Math.max(RATING_MIN, Math.min(RATING_MAX, v));
}

function clampDial(v) {
  return Math.max(5, Math.min(97, v));
}

// 基础强度旋钮(0-100 的连续值,不是三档):由"林墨分 - 玩家分"的差距
// 决定——林墨比玩家强得越多,旋钮越靠近 100(几乎不留情面);玩家比
// 林墨强,旋钮往下走,让玩家能感觉到自己在"赢一个和自己差不多强、
// 甚至更强的对手",而不是心知肚明在欺负一个杵在原地的木桩子。
function baseDial(playerRating, linmoRating) {
  return clampDial(50 + (linmoRating - playerRating) * 1.5);
}

// 连胜/连败修正:见文件头注释第 3 条
function streakAdjustment(streak) {
  if (streak >= 3) return Math.min(10, (streak - 2) * 3); // 连胜越久,加得越多,封顶 +10
  if (streak <= -2) return Math.max(-14, (streak + 1) * 4); // 连败越久,减得越多,封顶 -14
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

/**
 * 算出"这一步"该用的强度旋钮。之所以不是算一次用一整局,是因为
 * flowAdjustment 要跟着局面实时变——每次轮到林墨走之前都应该重新算。
 */
export function computeSkillDial({ playerRating, linmoRating, streak, board, aiColor = LINMO_COLOR, humanColor = PLAYER_COLOR }) {
  const base = baseDial(playerRating, linmoRating);
  const adjusted = base + streakAdjustment(streak) + flowAdjustment(board, aiColor, humanColor);
  return clampDial(Math.round(adjusted));
}

// 简单档:纯静态评估 + 加权随机(跟 ai.js 的 pickEasy 等价,单独写一份
// 是因为这里 pool 已经在外层按 dial 连续算好了,不需要再依赖 ai.js
// 内部没导出的那个 pickEasy)
function pickByDialLow(pool) {
  return weightedRandomPick(pool, (c) => Math.max(c.attack, c.defend));
}

// 中档:1 层前瞻(倒扣对手最优回应)
function pickByDialMid(board, pool, aiPlayer, humanPlayer) {
  const withLookahead = pool.map((c) => {
    const trial = cloneBoard(board);
    trial[c.y][c.x] = aiPlayer;
    const oppBest = bestScoreFor(trial, humanPlayer, aiPlayer);
    let finalScore = Math.max(c.attack, c.defend) - oppBest * 0.9;
    if (countLiveThreeThreats(trial, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 3;
    }
    return { x: c.x, y: c.y, finalScore };
  });
  return weightedRandomPick(withLookahead, (c) => c.finalScore);
}

// 高档:2 层前瞻,零随机,直接选算出来最优的一手
function pickByDialHigh(board, pool, aiPlayer, humanPlayer) {
  const topCandidates = [...pool]
    .sort((a, b) => Math.max(b.attack, b.defend) - Math.max(a.attack, a.defend))
    .slice(0, 8);

  let best = null;
  for (const c of topCandidates) {
    const board1 = cloneBoard(board);
    board1[c.y][c.x] = aiPlayer;
    let finalScore = Math.max(c.attack, c.defend);

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
      finalScore = finalScore - oppScore * 0.9 + aiFollowUp * 0.5;
    }
    if (countLiveThreeThreats(board1, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 8;
    }
    if (!best || finalScore > best.finalScore) {
      best = { x: c.x, y: c.y, finalScore };
    }
  }
  return best;
}

/**
 * 给定连续强度旋钮 dial(0-100),算出林墨这一步该下在哪。
 * 必杀/必防(findForcedMove)永远不受 dial 影响——这是可信度的底线,
 * 不管当前旋钮多低,都不能让林墨对着一步就能赢/一步就会输的棋视而不见。
 */
export function getAdaptiveMove(board, aiPlayer, humanPlayer, dial) {
  const scored = scoreCandidates(board, aiPlayer, humanPlayer);
  if (!scored.length) return null;

  const forced = findForcedMove(scored);
  if (forced) return forced;

  const threatPool = findThreatPool(scored);
  const pool = threatPool || generalPool(scored, 0.42 + (dial / 100) * 0.38);

  if (dial >= 70) return pickByDialHigh(board, pool, aiPlayer, humanPlayer);
  if (dial >= 35) return pickByDialMid(board, pool, aiPlayer, humanPlayer);
  return pickByDialLow(pool);
}

// ---- 赛后"要不要再来一局"的邀请概率 ----
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
//   lib/linmoDialogue.js 的 DAILY_PLAYER_INVITE_DECLINE_REASONS)。
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
