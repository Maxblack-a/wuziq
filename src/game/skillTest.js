// 棋力测试(林墨)引擎
// ------------------------------------------------------------
// 设计要点(跟产品沟通对齐过的几条硬约束,改动这个文件之前先看这里):
//
// 1. 玩家固定执黑先手,林墨固定执白——测试局不提供选边,省掉一次无意义的
//    选择,也让"你先来"成为林墨待客的一部分(叙事上说得通)。
// 2. 结束条件是"关卡驱动",不是"胜负驱动":真正五连分出胜负当然直接结束
//    (林墨的底线防守逻辑始终在,不会被这套测试逻辑绕过),但正常情况下
//    测试目标是把三个关卡(防守/进攻/全局)走一遍,而不是分出输赢。
// 3. 三个关卡(防守/进攻/全局)不管前一关测得怎么样都会走完,不再有
//    "某一关表现差就跳过后面"的分层降级——之前这个设计的本意是"没必要
//    在明显很弱的玩家身上继续测更难的能力",但代价是很多玩家只是这一次
//    没抓住,后面完全有能力展示,却被提前剥夺了机会,六维图里一大半
//    留空(默认中性分),体验上像是"还没怎么下就结束了"。
// 4. 催化改成确定性触发:条件够了就必然触发,不再有"随机概率"White白
//    拖延的情况;每个阶段的催化窗口按"进入这个阶段之后过了几步"算,
//    不是整局的绝对步数——不然前面阶段拖久了,后面阶段的催化时机会
//    被顺移打乱。
// 5. 步数硬顶 MAX_MOVES_PER_SIDE:不管关卡进度如何,到了就收官。
//    同时有一个步数下限 MIN_MOVES_PER_SIDE:就算关卡提前都测完了,也
//    不能立刻收官——在到达下限之前,林墨仍然保持克制(不下真正的杀棋),
//    避免出现"一两分钟就结束"这种显得敷衍的情况。
// 6. 记录的是原始信号(逐步棋谱 + 关卡事件),不是直接算好的分数——分数
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

export const MAX_MOVES_PER_SIDE = 20; // 硬顶:超过就不管关卡进度直接收官
export const MIN_MOVES_PER_SIDE = 10; // 下限:没到这个步数,就算关卡都测完了也不收官
const OPENING_SAMPLE_MOVES = 3; // 前几手算"开局采样",不触发任何关卡判定
const OFFENSE_WINDOW = 3; // 进攻关卡:给玩家这么多手的窗口去抓机会
const CATALYZE_WINDOW = 4; // 进入某个"看"阶段之后,最多这么多手内必须催化触发

// 关卡阶段机器:opening -> defense_watch -> offense_watch -> global_watch -> closing
export function createTestState() {
  return {
    phase: "opening",
    phaseEnteredAt: 0, // 当前阶段是在第几手进入的——催化窗口按"相对这个阶段"算
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
    next.openingSamples = [...next.openingSamples, { x, y, distToNearestOwn: d }];
  }

  // 双活三(双三杀)是五子棋规则里真正意义上的必胜棋型——林墨一步只能
  // 挡住其中一条线,另一条线下一手就会被补成活四,直接赢棋。这本来就是
  // "进攻"关卡故意要测的东西(能不能下出双活三),但下面 offense_watch
  // 分支里的判定只在"诱导"这个专门窗口期生效;真实情况是,棋力强的
  // 玩家未必会乖乖等到这个窗口才发力,在"观察/控场/收网"任何一个阶段
  // 都可能提前做出双活三,棋照样会正常分出胜负、提前结束测试——但如果
  // 判定没触发,这一步漂亮的攻杀就不会被记成"进攻关卡命中",六维图里
  // 攻击力只能停在中性分,跟玩家实际靠攻杀赢棋的表现完全对不上。这里
  // 单独补一道不分阶段的判定,只要这局"进攻"这一项还没出过结果,任何
  // 阶段做出双活三都直接记 hit——不影响 offense_watch 自己原有的判定
  // (那边命中了就不会再进这里,靠 alreadyHasOffenseResult 挡住重复记录)。
  const alreadyHasOffenseResult = testState.checkpoints.some((c) => c.type === "offense");
  if (!alreadyHasOffenseResult && testState.phase !== "offense_watch"
    && mine.attack >= SCORE.LIVE_THREE && countLiveThreeThreatsAfter(board, x, y) >= 2) {
    next.checkpoints = [...next.checkpoints, {
      type: "offense", triggeredAtMove: next.moves.length, result: "hit",
      detail: { move: [x, y] }, catalyzed: false,
    }];
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
      // 不管这一关测得怎么样,都继续往下测进攻关卡——三个关卡尽量都测到
      next.phase = "offense_watch";
      next.phaseEnteredAt = next.moveIndex;
      next.offenseWindowStart = next.moveIndex;
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
    // 注意:这里 board 是玩家落子"之前"的局面(调用方保证),countLiveThreeThreatsAfter
    // 判断的是"玩家这一步落下去之后,有几个点能让他再做一次活三"——如果玩家
    // 这一步真的落在能形成双活三的点上,说明抓住了
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
      next.phaseEnteredAt = next.moveIndex;
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
        next.phaseEnteredAt = next.moveIndex;
      }
    } else if (windowUsed >= OFFENSE_WINDOW) {
      next.checkpoints = [...next.checkpoints, {
        type: "offense", triggeredAtMove: windowStart,
        result: next.pendingOffensePartial ? "partial" : "miss",
        detail: {}, catalyzed: false,
      }];
      // 不管这一关测得怎么样,都继续往下测全局关卡
      next.phase = "global_watch";
      next.phaseEnteredAt = next.moveIndex;
    }
  }

  // 应变力信号:上一个关卡如果是 miss 或 partial(受挫程度不同,但都算
  // 遇到了压力),顺手记一下"受挫后几步"的分数走势——原来只认 miss,
  // 样本太薄,大多数局都测不出这个维度
  const lastCheckpoint = next.checkpoints[next.checkpoints.length - 1];
  if (lastCheckpoint && (lastCheckpoint.result === "miss" || lastCheckpoint.result === "partial")) {
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

// 只处理"必须挡"的一半(不管进攻分多高,都不主动去完成它)——复用
// ai.js 里同样的分级阈值,但只看 defend 这一侧。给"没到步数下限之前"
// 这段时间用,保证林墨不会自己输,但也不会自己抢先把棋赢了。
function findDefensiveForcedMove(scored) {
  const five = scored.find((c) => c.defend >= SCORE.FIVE);
  if (five) return five;
  const liveFour = scored.find((c) => c.defend >= SCORE.LIVE_FOUR);
  if (liveFour) return liveFour;
  const four = scored.find((c) => c.defend >= SCORE.FOUR);
  if (four) return four;
  return null;
}

// 林墨落子:根据当前阶段决定这一步怎么下,返回 { move, testState, dialogueKey }
// dialogueKey 非空时,SkillTestScreen 会顺带弹一句林墨的台词
function decideLinMoMove(board, testState) {
  const rawScored = scoreCandidates(board, LINMO_COLOR, PLAYER_COLOR);
  if (!rawScored.length) return { move: null, testState, dialogueKey: null };

  // 没到步数下限之前,林墨"必须应对"只保留防守这一半——不能让自己
  // 输(该挡还是要挡),但不会主动去完成自己的必杀(哪怕已经形成活四/
  // 冲四这种基本锁定胜局的棋型,也先不下最后那一步)。这是"不要一两
  // 分钟就结束"这个要求真正生效的关键一步——不然防守关卡一旦触发,
  // 玩家没防住,林墨会顺着这条线一路杀到底,跟"他现在只是在观察你,
  // 不是真的要赢"这个人设矛盾。
  //
  // 注意:这里不能只看步数够不够——如果步数刚好到了下限、但关卡还没
  // 全部测完(还在 offense_watch/global_watch 阶段),同样不放开,不然
  // 会出现"整局一直留着一条没处理的活三,步数一到下限就立刻收官把棋
  // 赢了"这种卡在临界点上的突兀感,而且往往全局关卡还没来得及测。
  // 只有步数够了、而且三个关卡都已经有结果(真正进入 closing 阶段)
  // 之后,才恢复成完整的必杀/必防判断。
  const stillTesting = testState.moveIndex < MIN_MOVES_PER_SIDE || testState.phase !== "closing";
  const forced = stillTesting ? findDefensiveForcedMove(rawScored) : findForcedMove(rawScored);
  if (forced) return { move: forced, testState, dialogueKey: null };

  // 除了上面这层"必须应对"的判断,下面所有分支挑棋的候选池也要跟着
  // 收紧——测试还没结束之前,直接把"进攻分已经到活四/五连"这种候选从
  // 池子里砍掉,不给加权随机/关卡挑选任何机会不小心选中它们。真正进入
  // 收官阶段,池子才恢复完整。
  const scored = stillTesting ? rawScored.filter((c) => c.attack < SCORE.LIVE_FOUR) : rawScored;
  if (stillTesting && !scored.length) {
    // 极端情况:砍完之后候选池空了(比如棋盘已经被逼到只剩下能连成
    // 活四的点),退回未砍的池子,不能让林墨无棋可下
    scored.push(...rawScored);
  }

  let dialogueKey = null;
  let next = testState;

  if (testState.phase === "opening") {
    // 观察阶段:占据关键位置、不主动进攻——用较窄的候选池 + 加权随机,
    // 避免每次都下一模一样的开局,但也不深算,保留"还在观察你"的克制感
    const move = weightedRandomPick(generalPool(scored, 0.6), (c) => Math.max(c.attack, c.defend) * 0.5 + 1);
    let enteringControl = false;
    if (testState.moveIndex >= OPENING_SAMPLE_MOVES) {
      next = { ...testState, phase: "defense_watch", phaseEnteredAt: testState.moveIndex };
      enteringControl = true;
    }
    // 观察阶段一结束就正式"控场"(防守关卡窗口打开),给一句过渡台词,
    // 让玩家能感觉到"刚才还在看,现在开始认真了"——四个阶段里第一处
    // 节奏切换点
    return { move, testState: next, dialogueKey: enteringControl ? "phase_control" : null };
  }

  if (testState.phase === "defense_watch") {
    // 防守关卡:主动做一个活三,逼玩家应招。只要有这样的机会就必然
    // 触发(不再是"随机概率"),催化窗口按"进入这个阶段之后过了几步"算。
    // 注意:只挑"活三这一档"的候选,不要不小心挑到活四/冲四这种已经
    // 更高一级、接近锁定胜局的棋型——这一步的目的是"抛出一个能测出
    // 反应的威胁",不是抢跑去追求真正的杀棋。
    const liveThreeMoves = scored.filter((c) => c.attack >= SCORE.LIVE_THREE && c.attack < SCORE.LIVE_FOUR);
    const shouldCatalyze = (testState.moveIndex - testState.phaseEnteredAt) >= CATALYZE_WINDOW;
    if (liveThreeMoves.length) {
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
          bestDefend, catalyzed: shouldCatalyze,
        },
      };
      dialogueKey = "defense_trigger";
      return { move, testState: next, dialogueKey };
    }
    // 棋盘上暂时凑不出活三机会:先按常规下法建设一手(为下次找机会铺垫)
    const move = weightedRandomPick(generalPool(scored, 0.65), (c) => Math.max(c.attack, c.defend));
    return { move, testState, dialogueKey: null };
  }

  if (testState.phase === "offense_watch") {
    // 进攻关卡窗口:故意放软——不抢玩家正在积累的线(排除高 defend 的
    // 封堵型选项),给他机会自己做出双活三
    const soft = scored.filter((c) => c.defend < SCORE.LIVE_THREE * 0.8);
    const pool = soft.length ? soft : scored;
    const move = weightedRandomPick(generalPool(pool, 0.55), (c) => Math.max(c.attack, c.defend * 0.3) + 1);
    // 刚从"控场"切进"诱导"阶段的第一手,给一句过渡台词——语气上要体现
    // "我先松一松,看你敢不敢"这个态度上的转变,不然玩家只会觉得林墨
    // 突然变弱了,却不知道这是故意的
    const enteringEntice = testState.moveIndex === testState.phaseEnteredAt;
    return { move: move, testState, dialogueKey: enteringEntice ? "phase_entice" : null };
  }

  if (testState.phase === "global_watch") {
    // 全局关卡:检查棋盘上是不是已经天然存在两处热点;没有的话,只要
    // 到了催化窗口,林墨就必然主动在远离当前焦点的地方另起一条活三线,
    // 制造"两头都要顾"的局面——不再靠概率去赌会不会触发
    const hotPoints = scored.filter((c) => c.attack >= SCORE.LIVE_THREE || c.defend >= SCORE.LIVE_THREE);
    const clusters = clusterHotPoints(hotPoints);
    const shouldCatalyze = (testState.moveIndex - testState.phaseEnteredAt) >= CATALYZE_WINDOW;

    if (clusters.length >= 2 || shouldCatalyze) {
      // 已经有两个热点簇了(或者到了该催化的手数),从候选里挑一手,
      // 之后把"这一步之后玩家该怎么选"的最佳组合分记下来,给下一步判定用
      let move;
      if (clusters.length >= 2) {
        // 天然已经存在双热点:林墨正常应对最紧迫的一处即可,不用再额外动作
        move = clusters.flat().reduce((a, b) => (Math.max(b.attack, b.defend) > Math.max(a.attack, a.defend) ? b : a));
      } else {
        // 催化:找一个能形成活三(不超过活三这一档,同样不抢跑去追求
        // 真正的杀棋)、且离最近一次落子较远的点,主动开辟第二战场;
        // 找不到就退而求其次挑一个离得够远、分数最高的点,保证这一步
        // 一定会下(不会因为凑不出活三就干等着不触发)
        const lastMove = testState.moves[testState.moves.length - 1];
        const farThreat = scored.filter((c) => c.attack >= SCORE.LIVE_THREE && c.attack < SCORE.LIVE_FOUR
          && (!lastMove || dist([c.x, c.y], [lastMove.x, lastMove.y]) > 4));
        const farAny = scored.filter((c) => !lastMove || dist([c.x, c.y], [lastMove.x, lastMove.y]) > 4);
        const pool = farThreat.length ? farThreat : (farAny.length ? farAny : scored);
        move = pool.reduce((a, b) => (Math.max(b.attack, b.defend) > Math.max(a.attack, a.defend) ? b : a));
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
    // 没触发本轮的"收网"考验,但如果这是刚从"诱导"切进来的第一手,
    // 仍然给一句过渡台词,提醒玩家棋盘不止一处——不然这个阶段切换
    // 可能完全悄无声息地过去
    const enteringNet = testState.moveIndex === testState.phaseEnteredAt;
    return { move, testState, dialogueKey: enteringNet ? "phase_net" : null };
  }

  // closing:关卡都测完了。如果还没到最低步数门槛,继续保持克制——不下
  // 真正的杀棋,避免测试提前结束、显得敷衍(这里的 scored 已经是上面
  // 砍掉活四/五连候选之后的池子了);到了门槛之后才正常发挥收官。
  // 刚从"收网"切进"收官"的第一手,给一句收尾过渡台词——closingBuffer
  // 只在真正进入 closing 之后才会被 recordLinMoMove 递增,这里读到的
  // 还是"这一手之前"的值,等于 0 就说明是这个阶段的第一手。
  const enteringClosing = testState.phase === "closing" && testState.closingBuffer === 0;
  if (stillTesting) {
    const move = weightedRandomPick(generalPool(scored, 0.65), (c) => Math.max(c.attack, c.defend));
    return { move, testState, dialogueKey: enteringClosing ? "phase_closing" : null };
  }
  const move = bestMoveFor(board, LINMO_COLOR, PLAYER_COLOR) || weightedRandomPick(generalPool(scored, 0.7), (c) => Math.max(c.attack, c.defend));
  return { move, testState, dialogueKey: enteringClosing ? "phase_closing" : null };
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
    // 还要同时满足两个条件才真正结束:①收官缓冲够了(2手)②达到最低
    // 步数门槛——任何一条没满足,都不能收官,这是"不要一两分钟就结束"
    // 这个要求的具体落地。
    return testState.closingBuffer >= 2 && testState.moveIndex >= MIN_MOVES_PER_SIDE;
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
