// 象棋版棋力测试 —— 六维画像的简化移植版
// ------------------------------------------------------------
// 说明:原版 skillTest.js(五子棋)是一整套"关卡状态机"——防守/全局观/
// 进攻三关,按棋盘上真实出现的棋型(活三/冲四)确定性催化触发,逐关记录
// 命中/部分命中/未命中,是相当精细的一套设计。要给象棋做等价的"关卡"
// (比如专门设计"这一步必须弃子解将""这里有个抽将机会"这类会自然出现
// 在对局里的考点,并且保证多数对局里都会触发),需要重新设计一整套象棋
// 战术分类和触发条件,工作量不比重写一次象棋 AI 小。
//
// 这一版先做一个更直接、但同样"从真实这一局的数据里派生分数"的简化版:
// 玩家执红先手,跟一个中等强度 AI 下一整盘棋(下到真正分出胜负或到步数
// 硬顶),逐步记录"这一步实际选择 vs 当时理论最优"的比值(跟每日试炼的
// computeMatchQuality 是同一个原语),再按"这一步发生的情境"分桶算出
// 六个维度——保留了原版"数据来自真实对局、不是问卷"这条核心设计原则,
// 但不再有原版那套确定性催化的关卡机器。維度定义(attack/defense/
// vision/calc/opening/adapt)和 lib/skillProfile.js 保持同名,以后想把
// 这份换成更精细的关卡制版本,只要保持这六个 key 的输出格式不变,
// ProfileScreen 的雷达图和 submit_skill_test_result 都不用跟着改。
import {
  createInitialBoard, applyMove, checkGameOver, isInCheck, positionKey, RED, BLACK,
} from "./xiangqiLogic";
import { scoreCandidates, chooseAiMove, VALUE } from "./xiangqiAi";

export const PLAYER_COLOR = RED;
export const AI_COLOR = BLACK;
export const MAX_MOVES_PER_SIDE = 60;

export function createTestState() {
  return {
    board: createInitialBoard(),
    turn: RED,
    moveIndex: 0,
    // 字段名特意叫 moves 而不是 log——App.jsx 里 handleSkillTestFinish
    // 组 skill_test_raw 时按 testState.moves/testState.checkpoints/
    // testState.openingSamples 这三个字段名去取(那是给五子棋版关卡制
    // 引擎设计的字段),这里保持同名以复用同一份 App.jsx 逻辑不用改。
    // checkpoints/openingSamples 这一版简化引擎没有对应概念,给空数组
    // 占位即可——服务端 submit_skill_test_result 只强校验
    // p_raw->'moves' 非空,不关心另外两个字段。
    moves: [], // { bestAvailable, actual, wasInCheck, hadBigCapture, afterOpponentCapture, phase }
    checkpoints: [],
    openingSamples: [],
    lastMoveWasCapture: false,
    positionHistory: [],
    noCaptureHalfmoves: 0,
  };
}

// 玩家落子(在应用到棋盘之前调用,原因跟每日试炼版一致——要拿玩家落子
// 之前那一刻真正面对的局面来算 bestAvailable,不能用自己刚下完的棋盘算)
export function recordPlayerMove(state, from, to) {
  const scored = scoreCandidates(state.board, PLAYER_COLOR, AI_COLOR);
  const bestAvailable = scored.length ? Math.max(...scored.map((c) => Math.max(c.attack, c.defend))) : 0;
  const chosen = scored.find((c) => c.from[0] === from[0] && c.from[1] === from[1] && c.to[0] === to[0] && c.to[1] === to[1]);
  const actual = chosen ? Math.max(chosen.attack, chosen.defend) : 0;
  const wasInCheck = isInCheck(state.board, PLAYER_COLOR);
  const hadBigCapture = scored.some((c) => c.attack >= VALUE[5] * 0.9); // 有价值接近车的吃子机会摆在那
  const phase = state.moveIndex < 8 ? "opening" : state.moveIndex < 24 ? "middle" : "late";

  state.moves.push({
    bestAvailable, actual, wasInCheck, hadBigCapture,
    afterOpponentCapture: state.lastMoveWasCapture, phase,
  });

  const captured = state.board[to[1]][to[0]] !== 0;
  state.board = applyMove(state.board, from, to);
  state.lastMoveWasCapture = captured;
  state.moveIndex += 1;
  state.turn = AI_COLOR;
  state.noCaptureHalfmoves = captured ? 0 : state.noCaptureHalfmoves + 1;
  state.positionHistory = [...state.positionHistory, positionKey(state.board, state.turn)];
}

// AI 走子:中等强度,给玩家一个有来有回、不会一边倒的对局,好让六个维度
// 都有机会在真实局面里被观察到——太弱玩家几步就赢,后面维度没数据;
// 太强玩家几步就输,同样没数据。
export function getTestAiMove(state) {
  return chooseAiMove(state.board, AI_COLOR, "normal");
}

export function recordAiMove(state, move) {
  const captured = state.board[move.to[1]][move.to[0]] !== 0;
  state.board = applyMove(state.board, move.from, move.to);
  state.lastMoveWasCapture = captured;
  state.turn = PLAYER_COLOR;
  state.noCaptureHalfmoves = captured ? 0 : state.noCaptureHalfmoves + 1;
  state.positionHistory = [...state.positionHistory, positionKey(state.board, state.turn)];
}

export function checkTestOver(state) {
  if (state.moveIndex >= MAX_MOVES_PER_SIDE) return { over: true, reason: "move_cap" };
  const over = checkGameOver(state.board, state.turn, state.positionHistory, state.noCaptureHalfmoves);
  if (over) return { over: true, reason: over.reason, winner: over.winner };
  return null;
}

// ---- 从 log 派生六维分数 ----
function ratio(list) {
  const relevant = list.filter((m) => m.bestAvailable > 0);
  if (!relevant.length) return null;
  const sum = relevant.reduce((s, m) => s + Math.min(1, m.actual / m.bestAvailable), 0);
  return sum / relevant.length;
}
function toScore(r, fallback = 50) {
  if (r == null) return { score: fallback, confidence: "estimated" };
  return { score: Math.round(20 + r * 75), confidence: "natural" }; // 映射到 20-95,避免贴着 0/100 两端显得极端
}

export function computeXiangqiSkillProfile(log) {
  const overall = ratio(log);

  const openingMoves = log.filter((m) => m.phase === "opening");
  const midLateMoves = log.filter((m) => m.phase !== "opening");
  const inCheckMoves = log.filter((m) => m.wasInCheck);
  const captureOppMoves = log.filter((m) => m.hadBigCapture);
  const afterHitMoves = log.filter((m) => m.afterOpponentCapture);

  const dims = {
    opening: toScore(ratio(openingMoves), 50).score,
    vision: toScore(ratio(midLateMoves), 50).score,
    defense: toScore(inCheckMoves.length ? ratio(inCheckMoves) : overall, 50).score,
    attack: toScore(captureOppMoves.length ? ratio(captureOppMoves) : overall, 50).score,
    adapt: toScore(afterHitMoves.length ? ratio(afterHitMoves) : overall, 50).score,
    calc: toScore(overall, 50).score,
  };

  const hiddenScore = Math.round(
    Object.values(dims).reduce((a, b) => a + b, 0) / Object.values(dims).length
  );

  // 简单的棋手类型判定:取分数最高的维度,跟原版"六维里最突出的一项
  // 决定称号"思路一致,只是不做更复杂的组合规则判断。
  const topDim = Object.entries(dims).sort((a, b) => b[1] - a[1])[0][0];
  const TYPE_INFO = {
    attack: { key: "attack", name: "锐意进取型", summary: "抓机会果断,吃子从不手软,擅长制造威胁。" },
    defense: { key: "defense", name: "稳健防守型", summary: "被将军时应对沉稳,很少留下破绽。" },
    vision: { key: "vision", name: "全局统筹型", summary: "中后盘处理得体,子力调度有章法。" },
    calc: { key: "calc", name: "精密计算型", summary: "落子贴近理论最优解,少走亏损的棋。" },
    opening: { key: "opening", name: "布局扎实型", summary: "开局阶段选点稳妥,给中盘打好了基础。" },
    adapt: { key: "adapt", name: "随机应变型", summary: "对方吃子之后反应快,不容易被打乱节奏。" },
  };
  const typeInfo = TYPE_INFO[topDim] || { key: "balanced", name: "均衡型", summary: "六维发展比较均衡,没有明显短板。" };

  const confidence = log.length >= 16 ? "natural" : log.length >= 6 ? "assisted" : "estimated";

  return {
    dims, hiddenScore: Math.max(0, Math.min(100, hiddenScore)),
    type: typeInfo.name, // 字符串形式,给 App.jsx 写 skill_test_type 用
    typeInfo,             // {key,name,summary} 对象形式,给 SkillTestResultScreen 渲染用
    confidence,
  };
}
