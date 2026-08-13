// 棋力测试(林墨)引擎
// ------------------------------------------------------------
// 设计要点(跟产品沟通对齐过的几条硬约束,改动这个文件之前先看这里):
//
// 1. 玩家固定执黑先手,林墨固定执白——测试局不提供选边,省掉一次无意义的
//    选择,也让"你先来"成为林墨待客的一部分(叙事上说得通)。
// 2. 结束条件是"关卡驱动",不是"胜负驱动":真正五连分出胜负当然直接结束
//    (林墨的底线防守逻辑始终在,不会被这套测试逻辑绕过),但正常情况下
//    测试目标是把三个关卡(防守/进攻/全局)走一遍,而不是分出输赢。
// 3. 分层测试:防守关卡如果完全没反应(complete miss),后面的进攻/全局
//    关卡就不测了,直接收官——没必要在一个连活三都看不出来的用户身上,
//    继续花手数测双线布局这种更高阶的能力。
// 4. 硬顶步数:MAX_MOVES_PER_SIDE,不管关卡进度如何,到了就收官,用已收集
//    到的数据出结果,不让新用户等太久。
// 5. 记录的是原始信号(逐步棋谱 + 关卡事件),不是直接算好的分数——分数
//    在 lib/skillProfile.js 里从这些原始信号派生,这样以后要调权重/加维度
//    不用重新设计埋点。
import { BLACK, WHITE, checkWin, cloneBoard } from "./logic";
import {
  SCORE,
  scoreCandidates,
  findForcedMove,
  bestMoveFor,
  countLiveThreeThreats,
  generalPool,
  weightedRandomPick,
} from "./ai";

export const PLAYER_COLOR = BLACK; // 棋力测试里玩家固定执黑先手
export const LINMO_COLOR = WHITE;

export const MAX_MOVES_PER_SIDE = 16; // 硬顶:超过就不管关卡进度直接收官
const OPENING_SAMPLE_MOVES = 3; // 前几手算"开局采样",不触发任何关卡判定
const OFFENSE_WINDOW = 3; // 进攻关卡:给玩家这么多手的窗口去抓机会
const CATALYZE_AFTER = 5; // 防守/全局关卡:自然没触发的话,从第几手开始"催化"

// 关卡阶段机器:opening -> defense -> offense -> global -> closing
// 阶段之间不是严格线性的时间顺序,是"够条件就往下走,不够就跳过"
export function createTestState() {
  return {
    phase: "opening",
    moveIndex: 0, // 玩家已经走了几手(林墨手数跟玩家同步或差1,不单独计)
    moves: [], // 逐步棋谱: { turn, player, x, y, attack, defend, bestScore }
    checkpoints: [], // 关卡事件: { type, triggeredAtMove, result, detail, catalyzed }
    openingSamples: [], // 开局采样: { x, y, distToNearestOwn }
    pendingCheckpoint: null, // { type, referencePoint } 等待玩家下一步来判定
    closingBuffer: 0, // 进入 closing 阶段之后,双方各走了几手收官缓冲
    finished: false,
    finishReason: null, // 'checkpoints_done' | 'step_cap' | 'game_over'
  };
}

function dist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

// 玩家已有棋子里离 (x,y) 最近的一颗距离多远——布局感用:数值越小说明
// 这一步是围绕已有棋子连贯扩展,越大说明是散着下、另起炉灶
function nearestOwnDist(board, x, y, color) {
  let best = Infinity;
  for (let yy = 0; yy < board.length; yy++) {
    for (let xx = 0; xx < board.length; xx++) {
      if (board[yy][xx] === color) {
        const d = dist([x, y], [xx, yy]);
        if (d < best) best = d;
      }
    }
  }
  return best === Infinity ? null : best;
}

// 把"活三级别以上"的候选点按空间位置分成几簇(简单贪心:同一簇内两两
// 距离都 <= 3,不同簇之间至少一个方向距离 > 3)——全局关卡靠这个判断
// "棋盘上是不是同时存在两处都值得关注的地方"
function clusterHotPoints(points) {
  const clusters = [];
  for (const p of points) {
    let joined = false;
    for (const c of clusters) {
      if (c.some((q) => dist([p.x, p.y], [q.x, q.y]) <= 3)) {
        c.push(p);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push([p]);
  }
  return clusters;
}

// 记录玩家刚下的这一步,顺带判定它是不是在回应某个待判定的关卡
function recordPlayerMove(board, testState, x, y) {
  const scored = scoreCandidates(board, PLAYER_COLOR, LINMO_COLOR);
  // 玩家理论上可以点棋盘上任意一个空位,不一定落在 candidateMoves 圈定的
  // "已有棋子附近"范围内(比如开局第一手、或者故意跑去角落下一子)——
  // 这种情况下 scored 里找不到对应项,兜底给 0 分,不能让后面的关卡判定
  // 因为 undefined.defend 直接崩掉
  const mine = scored.find((c) => c.x === x && c.y === y) || { x, y, attack: 0, defend: 0 };
  const bestScore = scored.reduce((m, c) => Math.max(m, c.attack, c.defend), 0);
  const moveEntry = {
    turn: testState.moves.length + 1,
    player: "human",
    x, y,
    attack: mine?.attack ?? 0,
    defend: mine?.defend ?? 0,
    bestAvailable: bestScore,
  };

  const next = {
    ...testState,
    moves: [...testState.moves, moveEntry],
    moveIndex: testState.moveIndex + 1,
  };

  // 开局采样(前 OPENING_SAMPLE_MOVES 手,不带关卡判定)
  if (testState.moveIndex < OPENING_SAMPLE_MOVES) {
    const d = nearestOwnDist(board, x, y, PLAYER_COLOR);
    next.openingSamples = [...testState.openingSamples, { x, y, distToNearestOwn: d }];
  }

  // 有一个关卡正等着这一步来判定
  if (testState.pendingCheckpoint) {
    const pc = testState.pendingCheckpoint;

    if (pc.type === "defense") {
      const ratio = pc.bestDefend > 0 ? mine.defend / pc.bestDefend : 0;
      const result = ratio >= 0.95 ? "hit" : mine.defend >= SCORE.LIVE_THREE * 0.5 ? "partial" : "miss";
      next.checkpoints = [...next.checkpoints, {
        type: "defense", triggeredAtMove: pc.triggeredAtMove, result,
        detail: { playerDefend: mine.defend, bestDefend: pc.bestDefend }, catalyzed: pc.catalyzed,
      }];
      next.pendingCheckpoint = null;
      next.phase = result === "miss" ? "closing" : "offense_watch"; // 完全没防住:分层降级,直接收官
      next.offenseWindowStart = testState.moveIndex + 1;
    } else if (pc.type === "global") {
      const ratio = pc.bestCombined > 0 ? Math.max(mine.attack, mine.defend) / pc.bestCombined : 0;
      const result = ratio >= 0.9 ? "hit" : Math.max(mine.attack, mine.defend) >= SCORE.LIVE_THREE * 0.5 ? "partial" : "miss";
      next.checkpoints = [...next.checkpoints, {
        type: "global", triggeredAtMove: pc.triggeredAtMove, result,
        detail: { playerBest: Math.max(mine.attack, mine.defend), bestCombined: pc.bestCombined }, catalyzed: pc.catalyzed,
      }];
      next.pendingCheckpoint = null;
      next.phase = "closing";
    }
  } else if (testState.phase === "offense_watch") {
    // 进攻关卡窗口期:每一步都看有没有抓住机会,不是只看某一步
    const doubleCount = countLiveThreeThreats(board, PLAYER_COLOR, LINMO_COLOR);
    // 注意:这里 board 是玩家落子"之前"的局面(调用方保证),countLiveThreeThreats
    // 判断的是"玩家还没走这一步时,有几个点能让他一步做出活三"——如果玩家
    // 这一步真的落在其中一个双活三点上,说明抓住了
    const isDoubleThreePoint = mine?.attack >= SCORE.LIVE_THREE
      && countLiveThreeThreatsAfter(board, x, y) >= 2;

    const windowStart = testState.offenseWindowStart ?? testState.moveIndex;
    const windowUsed = testState.moveIndex + 1 - windowStart;

    if (isDoubleThreePoint) {
      next.checkpoints = [...next.checkpoints, {
        type: "offense", triggeredAtMove: windowStart, result: "hit",
        detail: { move: [x, y] }, catalyzed: false,
      }];
      next.phase = "global_watch";
    } else if (mine?.attack >= SCORE.LIVE_THREE) {
      // 拿到了单独的活三,但不是双活三——先记一手"部分命中"的候选,
      // 继续观察窗口剩余的手数看会不会进一步扩大成双活三
      next.pendingOffensePartial = { move: [x, y] };
      if (windowUsed >= OFFENSE_WINDOW) {
        next.checkpoints = [...next.checkpoints, {
          type: "offense", triggeredAtMove: windowStart, result: "partial",
          detail: { move: [x, y] }, catalyzed: false,
        }];
        next.phase = "global_watch";
      }
    } else if (windowUsed >= OFFENSE_WINDOW) {
      next.checkpoints = [...next.checkpoints, {
        type: "offense", triggeredAtMove: windowStart,
        result: next.pendingOffensePartial ? "partial" : "miss",
        detail: {}, catalyzed: false,
      }];
      // 进攻关卡都完全没反应:同样分层降级,不测全局关卡了
      next.phase = next.pendingOffensePartial ? "global_watch" : "closing";
    }
  }

  // 应变力信号:如果上一个关卡是 miss,顺手记一下"失误后几步"的分数走势
  const lastCheckpoint = next.checkpoints[next.checkpoints.length - 1];
  if (lastCheckpoint && lastCheckpoint.result === "miss") {
    const sinceMiss = next.moves.length - lastCheckpoint.triggeredAtMove;
    if (sinceMiss <= 3) {
      lastCheckpoint.recoveryTrend = [...(lastCheckpoint.recoveryTrend || []), moveEntry.attack + moveEntry.defend];
    }
  }

  if (next.moveIndex >= MAX_MOVES_PER_SIDE) {
    next.phase = "closing";
  }
  if (next.phase === "closing") {
    next.closingBuffer = (testState.phase === "closing" ? testState.closingBuffer : 0) + 1;
  }

  return next;

  // 内部小工具:玩家在 (x,y) 落子之后,棋盘上还有几个点能让他"再做一次
  // 活三"(数字越大说明这一步同时催生了多条线,是真正的双活三/多线杀棋)
  function countLiveThreeThreatsAfter(boardBefore, px, py) {
    const trial = cloneBoard(boardBefore);
    trial[py][px] = PLAYER_COLOR;
    return countLiveThreeThreats(trial, PLAYER_COLOR, LINMO_COLOR);
  }
}

// 林墨落子:根据当前阶段决定这一步怎么下,返回 { move, testState, dialogueKey }
// dialogueKey 非空时,SkillTestScreen 会顺带弹一句林墨的台词
function decideLinMoMove(board, testState) {
  const scored = scoreCandidates(board, LINMO_COLOR, PLAYER_COLOR);
  if (!scored.length) return { move: null, testState, dialogueKey: null };

  // 任何阶段都不能对"真正的必杀/必防"视而不见——底线安全,不然会显得
  // 林墨突然变得不合逻辑地弱智,反而破坏人设可信度
  const forced = findForcedMove(scored);
  if (forced) return { move: forced, testState, dialogueKey: null };

  let dialogueKey = null;
  let next = testState;

  if (testState.phase === "opening") {
    // 观察阶段:占据关键位置、不主动进攻——用较窄的候选池 + 加权随机,
    // 避免每次都下一模一样的开局,但也不深算,保留"还在观察你"的克制感
    const move = weightedRandomPick(generalPool(scored, 0.6), (c) => Math.max(c.attack, c.defend) * 0.5 + 1);
    if (testState.moveIndex >= OPENING_SAMPLE_MOVES) {
      next = { ...testState, phase: "defense_watch" };
    }
    return { move, testState: next, dialogueKey: null };
  }

  if (testState.phase === "defense_watch") {
    // 防守关卡:主动做一个活三,逼玩家应招
    const liveThreeMoves = scored.filter((c) => c.attack >= SCORE.LIVE_THREE);
    const shouldCatalyze = testState.moveIndex >= CATALYZE_AFTER;
    if (liveThreeMoves.length && (shouldCatalyze || Math.random() < 0.7)) {
      const move = liveThreeMoves.reduce((a, b) => (b.attack > a.attack ? b : a));
      // 关卡触发后,要用"林墨走完这步之后"的局面重新算一遍玩家的最佳防守点,
      // 而不是用触发前的 scored——落子之后棋盘变了,候选点的分数也会变
      const trial = cloneBoard(board);
      trial[move.y][move.x] = LINMO_COLOR;
      const playerScored = scoreCandidates(trial, PLAYER_COLOR, LINMO_COLOR);
      const bestDefend = playerScored.reduce((m, c) => Math.max(m, c.defend), 0);
      next = {
        ...testState,
        pendingCheckpoint: {
          type: "defense", triggeredAtMove: testState.moves.length + 1,
          bestDefend, catalyzed: shouldCatalyze && Math.random() >= 0.7,
        },
      };
      dialogueKey = "defense_trigger";
      return { move, testState: next, dialogueKey };
    }
    // 还没到催化条件、也没随到:先按常规下法建设一手(为下次找机会铺垫)
    const move = weightedRandomPick(generalPool(scored, 0.65), (c) => Math.max(c.attack, c.defend));
    return { move, testState, dialogueKey: null };
  }

  if (testState.phase === "offense_watch") {
    // 进攻关卡窗口:故意放软——不抢玩家正在积累的线(排除高 defend 的
    // 封堵型选项),给他机会自己做出双活三
    const soft = scored.filter((c) => c.defend < SCORE.LIVE_THREE * 0.8);
    const pool = soft.length ? soft : scored;
    const move = weightedRandomPick(generalPool(pool, 0.55), (c) => Math.max(c.attack, c.defend * 0.3) + 1);
    return { move: move, testState, dialogueKey: null };
  }

  if (testState.phase === "global_watch") {
    // 全局关卡:检查棋盘上是不是已经天然存在两处热点;没有的话,林墨
    // 主动在远离当前焦点的地方另起一条活三线,制造"两头都要顾"的局面
    const hotPoints = scored.filter((c) => c.attack >= SCORE.LIVE_THREE || c.defend >= SCORE.LIVE_THREE);
    const clusters = clusterHotPoints(hotPoints);

    if (clusters.length >= 2 || testState.moveIndex >= CATALYZE_AFTER + OFFENSE_WINDOW) {
      // 已经有两个热点簇了(或者到了该催化的手数),从候选里挑一手,
      // 之后把"这一步之后玩家该怎么选"的最佳组合分记下来,给下一步判定用
      let move;
      if (clusters.length >= 2) {
        // 天然已经存在双热点:林墨正常应对最紧迫的一处即可,不用再额外动作
        move = clusters.flat().reduce((a, b) => (Math.max(b.attack, b.defend) > Math.max(a.attack, a.defend) ? b : a));
      } else {
        // 催化:找一个能形成活三、且离最近一次落子较远的点,主动开辟第二战场
        const lastMove = testState.moves[testState.moves.length - 1];
        const far = scored.filter((c) => c.attack >= SCORE.LIVE_THREE
          && (!lastMove || dist([c.x, c.y], [lastMove.x, lastMove.y]) > 4));
        move = far.length
          ? far.reduce((a, b) => (b.attack > a.attack ? b : a))
          : weightedRandomPick(generalPool(scored, 0.6), (c) => Math.max(c.attack, c.defend));
      }

      const trial = cloneBoard(board);
      trial[move.y][move.x] = LINMO_COLOR;
      const playerScored = scoreCandidates(trial, PLAYER_COLOR, LINMO_COLOR);
      const playerHot = playerScored.filter((c) => c.attack >= SCORE.LIVE_THREE || c.defend >= SCORE.LIVE_THREE);
      if (clusterHotPoints(playerHot).length >= 2) {
        const bestCombined = playerScored.reduce((m, c) => Math.max(m, c.attack, c.defend), 0);
        next = {
          ...testState,
          pendingCheckpoint: {
            type: "global", triggeredAtMove: testState.moves.length + 1,
            bestCombined, catalyzed: clusters.length < 2,
          },
        };
        dialogueKey = "global_trigger";
      }
      return { move, testState: next, dialogueKey };
    }

    const move = weightedRandomPick(generalPool(scored, 0.65), (c) => Math.max(c.attack, c.defend));
    return { move, testState, dialogueKey: null };
  }

  // closing:关卡都测完了(或者被跳过了),正常发挥收官,不再刻意放水
  const move = bestMoveFor(board, LINMO_COLOR, PLAYER_COLOR) || weightedRandomPick(generalPool(scored, 0.7), (c) => Math.max(c.attack, c.defend));
  return { move, testState, dialogueKey: null };
}

function recordLinMoMove(board, testState, x, y) {
  const scored = scoreCandidates(board, LINMO_COLOR, PLAYER_COLOR);
  const mine = scored.find((c) => c.x === x && c.y === y) || { x, y, attack: 0, defend: 0 };
  const moveEntry = {
    turn: testState.moves.length + 1,
    player: "linmo",
    x, y,
    attack: mine?.attack ?? 0,
    defend: mine?.defend ?? 0,
  };
  const next = { ...testState, moves: [...testState.moves, moveEntry] };
  if (next.phase === "closing") next.closingBuffer = testState.closingBuffer + 1;
  return next;
}

function isFinished(testState) {
  if (testState.phase === "closing" && !testState.pendingCheckpoint) {
    // closing 阶段里,如果关卡都已经有结果、且没有正等待判定的关卡,
    // 再让林墨正常收几手官子(不超过硬顶)就可以结束——这里简单地
    // 用"进入 closing 之后又走了 2 手"作为收官缓冲,不用真下出胜负
    return testState.closingBuffer >= 2;
  }
  return false;
}

export const skillTestEngine = {
  createTestState,
  recordPlayerMove,
  decideLinMoMove,
  recordLinMoMove,
  isFinished,
};
