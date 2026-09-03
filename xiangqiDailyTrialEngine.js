// 每日试炼(林墨/苏晴/小七/沈知远)象棋版自适应引擎
// ------------------------------------------------------------
// 跟原来五子棋那份 dailyTrialEngine.js 的设计目标完全一致——不是让 NPC
// 下得多强,是让玩家每天都愿意回来再打一局。三条机制原样保留:
//   1. 心流通道:NPC 强度跟着玩家隐藏分走(baseDial)
//   2. 橡皮筋:同一局内,局面明显占优/落后时,强度小幅上调/下调
//      (flowAdjustment),必杀永远不受影响
//   3. 连胜/连败保护:streakAdjustment
//
// 评分系统(daily_trial_rating/streak/软启动这些数字、ELO 更新公式)完全
// 是服务器端 supabase/schema.sql 的 start_daily_trial/finish_daily_trial
// 在管,那两个函数只做"分数怎么涨跌"的记账,压根不关心棋盘长什么样,
// 象棋和五子棋完全共用,不需要改一行 SQL——这个文件只负责"给定当前
// 两边的分数,这一步该怎么下",跟原来分工一模一样。
//
// 落子评分本身不重新发明轮子,复用 game/xiangqiAi.js 里的
// scoreCandidates/findForcedMove/bestScoreFor/pickByDial* 这一套。
import { RED, BLACK } from "./xiangqiLogic";
import {
  scoreCandidates, findForcedMove, bestScoreFor,
  pickByDialLow, pickByDialMid, pickByDialHigh, styledBase,
} from "./xiangqiAi";

// ---- 棋风人格:数值跟五子棋版完全一样,原样搬过来 ----
// （见 dailyTrialEngine.js 文件头对每个人格数值来源的详细注释——
// 这几个数字是角色设定文档换算来的相对倍数,不是随便拍的,不应该在
// 移植的时候顺手改动,以免棋风跟角色设定对不上。）
const NPC_PERSONALITY = {
  linmo: { aggression: 1, caution: 1, precision: 1, patience: 1 },
  suqing: { aggression: 0.82, caution: 1.22, precision: 1.15, patience: 1.4 },
  xiaoqi: { aggression: 1.35, caution: 0.75, precision: 0.85, patience: 0.55 },
  shenzhiyuan: { aggression: 0.78, caution: 1.28, precision: 1.2, patience: 1.55 },
};
function getPersonality(npcId) {
  return NPC_PERSONALITY[npcId] || NPC_PERSONALITY.linmo;
}

const STYLE_REACTIONS = {
  suqing: {
    offensive: { aggression: 0.85, caution: 1.12 },
    defensive: { aggression: 1.15, caution: 0.92 },
  },
  xiaoqi: {
    offensive: { aggression: 0.95, caution: 1.08 },
    defensive: { aggression: 1.25, caution: 0.85 },
  },
};

export function createOpponentStyleState() {
  return { offensive: 0, defensive: 0, total: 0 };
}

// 象棋里"这一步算进攻还是防守倾向"的判断标准,换成用 attack/defend 分数
// (吃子+将军 vs 脱险+解将)的相对大小来看,思路跟五子棋版完全对应,只是
// 底层评分换了一套。
export function recordPlayerStyleSignal(styleState, boardBeforeMove, from, to, playerColor, opponentColor) {
  if (!styleState) return;
  const scored = scoreCandidates(boardBeforeMove, playerColor, opponentColor);
  const chosen = scored.find((c) => c.from[0] === from[0] && c.from[1] === from[1] && c.to[0] === to[0] && c.to[1] === to[1]);
  if (!chosen) return;
  styleState.total += 1;
  if (chosen.attack > chosen.defend * 1.15) {
    styleState.offensive += 1;
  } else if (chosen.defend > chosen.attack * 1.15) {
    styleState.defensive += 1;
  }
}

const STYLE_READING_MIN_SAMPLES = 4;

function applyOpponentStyleReading(personality, npcId, styleState) {
  const reactions = STYLE_REACTIONS[npcId];
  if (!reactions || !styleState || styleState.total < STYLE_READING_MIN_SAMPLES) {
    return personality;
  }
  const offensiveRatio = styleState.offensive / styleState.total;
  if (offensiveRatio >= 0.55) {
    const { aggression, caution } = reactions.offensive;
    return { ...personality, aggression: personality.aggression * aggression, caution: personality.caution * caution };
  }
  const defensiveRatio = styleState.defensive / styleState.total;
  if (defensiveRatio >= 0.55) {
    const { aggression, caution } = reactions.defensive;
    return { ...personality, aggression: personality.aggression * aggression, caution: personality.caution * caution };
  }
  return personality;
}

export const PLAYER_COLOR = RED;   // 每日试炼里玩家固定执红先手
export const NPC_COLOR = BLACK;

export const STAMINA_COST = 5;
export const DAILY_STAMINA_CAP = 20;

function clampDial(v) {
  return Math.max(5, Math.min(85, v));
}

export const SOFT_START_GAMES = 3;
export const SOFT_START_DIAL_CAP = 60;

function baseDial(playerRating, npcRating) {
  return clampDial(50 + (npcRating - playerRating) * 1.5);
}

function streakAdjustment(streak) {
  if (streak >= 3) return (streak - 2) * 3;
  if (streak <= -2) return (streak + 1) * 4;
  return 0;
}

// 单局内的"橡皮筋":用双方当前各自的最优候选分粗略估计"这个局面对谁
// 更有利"，跟五子棋版思路一致，阈值换成了象棋分值尺度(车=90分是最贵重
// 的非将帅子,阈值取一个中等吃子量级)。
const FLOW_THRESHOLD = 45;
function flowAdjustment(board, aiColor, humanColor) {
  const aiBest = bestScoreFor(board, aiColor, humanColor);
  const humanBest = bestScoreFor(board, humanColor, aiColor);
  const diff = humanBest - aiBest;
  if (diff > FLOW_THRESHOLD) return 8;
  if (diff < -FLOW_THRESHOLD) return -6;
  return 0;
}

function personalityDialOffset(personality) {
  const raw =
    (personality.precision - 1) * 8 +
    (personality.caution - 1) * 6 +
    (personality.patience - 1) * 12;
  return Math.max(-20, Math.min(20, Math.round(raw)));
}

export function computeSkillDial({ playerRating, npcRating, streak, board, aiColor = NPC_COLOR, humanColor = PLAYER_COLOR, gamesPlayed = Infinity, npcId }) {
  const base = baseDial(playerRating, npcRating);
  const offset = personalityDialOffset(getPersonality(npcId));
  const dial = clampDial(Math.round(base + streakAdjustment(streak) + flowAdjustment(board, aiColor, humanColor) - offset));
  if (gamesPlayed < SOFT_START_GAMES) {
    return Math.min(dial, SOFT_START_DIAL_CAP);
  }
  return dial;
}

/**
 * 给定连续强度旋钮 dial(0-100),算出 NPC 这一步该怎么走。
 * 能一步将死玩家,不管 dial/人格永远直接走——这是可信度的底线。
 */
export function getAdaptiveMove(board, aiColor, humanColor, dial, npcId = "linmo", opponentStyle = null) {
  const scored = scoreCandidates(board, aiColor, humanColor);
  if (!scored.length) return null;

  const forced = findForcedMove(scored, board, aiColor, humanColor);
  if (forced) return forced;

  const personality = applyOpponentStyleReading(getPersonality(npcId), npcId, opponentStyle);

  if (dial >= 70) return pickByDialHigh(board, scored, aiColor, humanColor, personality);
  if (dial >= 35) return pickByDialMid(board, scored, aiColor, humanColor, personality);
  return pickByDialLow(scored, personality);
}

// ---- 局势分类,给对局中的 NPC 表情/闲聊气泡用 ----
// 复用跟落子完全同一套 attack/defend 评分,保证台词判断标准跟 AI 真正
// 落子时用的标准对得上。象棋没有"活三/冲四"这种棋型概念,改成看吃子
// 价值 + 是否将军。
export function classifyMoveSituation(boardBeforeMove, move, aiColor, humanColor) {
  if (!move) return "neutral";
  const scored = scoreCandidates(boardBeforeMove, aiColor, humanColor);
  const picked = scored.find((c) => c.from[0] === move.from[0] && c.from[1] === move.from[1] && c.to[0] === move.to[0] && c.to[1] === move.to[1]);
  if (!picked) return "neutral";

  if (picked.defend >= 60) return "danger";   // 刚解掉将军或救回一枚要害子
  if (picked.attack >= 40) return "attack";   // 吃到值钱的子或顺手将军
  return "neutral";
}

// ---- 首页体力展示,逻辑跟五子棋版一字不差地搬过来:纯前端展示兜底,
//      权威重置仍然在服务器 ensure_daily_reset ----
export function getDisplayStamina(stamina, staminaDate) {
  if (typeof stamina !== "number") return DAILY_STAMINA_CAP;
  if (!staminaDate) return stamina;
  const today = new Date().toISOString().slice(0, 10);
  return staminaDate === today ? stamina : DAILY_STAMINA_CAP;
}

export const NPC_REMATCH_INVITE_RATE = 0.6;
export const NPC_ACCEPT_PLAYER_INVITE_RATE = 0.8;
export function rollNpcInvitesRematch() { return Math.random() < NPC_REMATCH_INVITE_RATE; }
export function rollNpcAcceptsPlayerInvite() { return Math.random() < NPC_ACCEPT_PLAYER_INVITE_RATE; }

// ---- 单局质量信号采集(赛后算 matchQuality 传给 finish_daily_trial 用)----
export function createMoveLog() {
  return [];
}

export function recordPlayerMove(moveLog, boardBeforeMove, from, to, playerColor, opponentColor) {
  const scored = scoreCandidates(boardBeforeMove, playerColor, opponentColor);
  const bestAvailable = scored.length ? Math.max(...scored.map((c) => Math.max(c.attack, c.defend))) : 0;
  const chosen = scored.find((c) => c.from[0] === from[0] && c.from[1] === from[1] && c.to[0] === to[0] && c.to[1] === to[1]);
  const actual = chosen ? Math.max(chosen.attack, chosen.defend) : 0;
  moveLog.push({ bestAvailable, actual });
}

export function computeMatchQuality(moveLog) {
  const relevant = moveLog.filter((m) => m.bestAvailable > 0);
  if (!relevant.length) return 0.5;
  const gaps = relevant.map((m) => Math.min(1, m.actual / m.bestAvailable));
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}
