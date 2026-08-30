import { useState, useRef, useEffect } from "react";
import Board from "./Board";
import PveResultReveal from "./PveResultReveal";
import { IconUndo, IconChevronLeft } from "./Icons";
import { createEmptyBoard, checkWin, isBoardFull, cloneBoard, BLACK, WHITE } from "../game/logic";
import { getAiMove } from "../game/ai";
import { isInTelegram, useTelegramBackButton, hapticNotify, confirmDialog } from "../lib/telegram";

// 五连线画完(见 board.css 里 .win-line-path 的 1000ms 动画)之后,再把
// 结算页跳出来——时长直接等于动画时长本身,不额外加停顿,因为连线画完
// 之后线本身不会消失,不需要多留一段"缓冲"时间。
const WIN_REVEAL_DELAY = 1000;
const DRAW_REVEAL_DELAY = 400;

// 思考延迟按难度区分:困难档想得更久一点、简单档更快,是白送的一个
// 难度暗示,比三档统一用同一个延迟更能强化"困难档在认真算"这个观感
const THINKING_DELAY = { easy: 250, medium: 450, hard: 700 };

// onExit: 返回上一页(绑定 Telegram 原生返回键,UI 上不再重复画一个返回
// 图标——那是系统层已经有的东西)。onExitHome: "返回首页"这颗按钮专用,
// 字面意思就是回首页,跟"返回上一页"是两件不同的事,不能共用 onExit,
// 不然从"匹配失败→先玩人机"这条路径进来时,点"返回首页"会被错误地
// 带回匹配页而不是真的首页。
export default function PveScreen({ onExit, onExitHome }) {
  useTelegramBackButton(onExit);
  const [difficulty, setDifficulty] = useState("medium");
  // 玩家执子颜色:null 表示还没选,先显示选边界面。之前默认写死玩家执黑,
  // AI 永远后手只能防守,现在交给玩家自己选先后手
  const [playerColor, setPlayerColor] = useState(null);
  const [board, setBoard] = useState(createEmptyBoard());
  const [turn, setTurn] = useState(BLACK); // 黑棋永远先手,这是五子棋规则本身,不因为谁执黑而变
  const [lastMove, setLastMove] = useState(null);
  const [winInfo, setWinInfo] = useState(null);
  const [result, setResult] = useState(null); // 'win' | 'lose' | 'draw' | null
  const [thinking, setThinking] = useState(false);
  // 胜负/和棋已经算出来了,但"结束状态"的 UI 还没切换出来、正在展示连线
  // 动画的这段缓冲期。这段时间棋盘要继续锁着,不然用户能趁这个空档再落
  // 一子、悔棋或者切难度,把已经结束的这盘棋搅乱。
  const [revealing, setRevealing] = useState(false);
  const [history, setHistory] = useState([]); // 用于悔棋

  const aiColor = playerColor === BLACK ? WHITE : BLACK;

  const revealTimerRef = useRef(null);
  // aiTimerRef: 记录当前挂起的"AI落子"计时器 id,好在有新计算触发/组件卸载时
  // 清掉上一个还没触发的计时器,避免同时有两个 AI 落子计时器在跑;
  // moveTokenRef: 每次真正开始一次新的 AI 计算就 +1,计时器触发时先核对
  // 手上的 token 是不是还是最新的那一次,不是的话说明中途已经被重置/顶掉了,
  // 直接放弃这次结果,不能再写回 state——这两个 ref 联手解决的是"切难度/
  // 重开一局的时候,上一次还没算完的 AI 落子突然冒出来把新棋盘弄乱"这个问题
  const aiTimerRef = useRef(null);
  const moveTokenRef = useRef(0);

  useEffect(() => {
    // 组件卸载时(比如 AI 思考中途/揭晓动画中途直接退出人机对战)清掉还没
    // 触发的计时器,避免它们之后再对一个已经不存在的组件调用 setState
    return () => {
      clearTimeout(revealTimerRef.current);
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, []);

  function applyMove(x, y, player, currentBoard) {
    const next = cloneBoard(currentBoard);
    next[y][x] = player;
    return next;
  }

  function scheduleReveal(delay, outcome) {
    setRevealing(true);
    revealTimerRef.current = setTimeout(() => {
      setResult(outcome);
      setRevealing(false);
    }, delay);
  }

  // AI 落子逻辑抽成独立函数:玩家落子后要调,玩家选执白、AI 先手开局时也要调,
  // 难度也显式当参数传进来,而不是读组件状态——避免"刚 setDifficulty 还没
  // 生效,这一步却已经在用旧难度算"这种 React 状态批处理时序问题
  function performAiMove(currentBoard, aiColorParam, humanColorParam, difficultyParam) {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current); // 顶掉上一个还没触发的计时器
    const token = ++moveTokenRef.current;
    setThinking(true);
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      // 这一次计算开始之后,又有更新的一次 performAiMove 被触发了(比如中途
      // 切了难度、重开了一局)——这个结果已经过期,不能再写回棋盘
      if (moveTokenRef.current !== token) return;

      const move = getAiMove(currentBoard, aiColorParam, humanColorParam, difficultyParam);
      if (!move) {
        // 极端边缘情况:棋盘上已经找不到任何候选点了,按和棋兜底处理——
        // 没有连线可看,直接给结果,不用走揭晓延迟那一套
        setThinking(false);
        setResult("draw");
        return;
      }
      const afterAi = applyMove(move.x, move.y, aiColorParam, currentBoard);
      setBoard(afterAi);
      setLastMove([move.x, move.y]);
      setThinking(false);

      const aiWin = checkWin(afterAi, move.x, move.y);
      if (aiWin) {
        setWinInfo(aiWin.line);
        hapticNotify("error");
        // 同样延迟一下切换——AI 赢的时候更要让人看清 AI 是怎么连成五子的,
        // 不然对着一个"突然就输了"的结果会觉得莫名其妙
        scheduleReveal(WIN_REVEAL_DELAY, "lose");
      } else if (isBoardFull(afterAi)) {
        scheduleReveal(DRAW_REVEAL_DELAY, "draw");
      } else {
        setTurn(humanColorParam);
      }
    }, THINKING_DELAY[difficultyParam] ?? 450);
  }

  // 支持传入 difficultyOverride:难度切换那一刻,新难度值还没写进 state,
  // 直接把这次要用的难度当参数传进来,不依赖组件状态,从根上避免"用旧难度
  // 算了 AI 切换后的第一步"这个问题
  function reset(difficultyOverride) {
    clearTimeout(revealTimerRef.current);
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    moveTokenRef.current++; // 让任何还没触发的旧 AI 计算作废
    setBoard(createEmptyBoard());
    setTurn(BLACK);
    setLastMove(null);
    setWinInfo(null);
    setResult(null);
    setRevealing(false);
    setHistory([]);
    if (playerColor === WHITE) {
      // 玩家执白,AI 执黑先手,重开一局要让 AI 自动走开局第一步
      performAiMove(createEmptyBoard(), BLACK, WHITE, difficultyOverride ?? difficulty);
    }
  }

  function handleColorSelect(chosenColor) {
    setPlayerColor(chosenColor);
    setBoard(createEmptyBoard());
    setTurn(BLACK);
    setLastMove(null);
    setWinInfo(null);
    setResult(null);
    setRevealing(false);
    setHistory([]);
    if (chosenColor === WHITE) {
      performAiMove(createEmptyBoard(), BLACK, WHITE, difficulty);
    }
  }

  async function handleDifficultyChange(key) {
    if (key === difficulty || thinking || revealing) return;
    // 对局已经结束的话没什么"放弃"可言,直接切,不用再确认一遍;
    // 棋盘上已经有子、对局还在进行中,手滑碰到难度按钮不该无声无息把这盘棋清空
    const inProgress = !result && (history.length > 0 || lastMove !== null);
    if (inProgress) {
      const confirmed = await confirmDialog("切换难度会放弃当前这盘棋,确定吗?");
      if (!confirmed) return;
      if (thinking || revealing) return; // 等确认框那段时间里状态变了,保险起见再挡一次
    }
    setDifficulty(key);
    reset(key); // 把新难度显式传给 reset,不依赖还没生效的 difficulty state
  }

  function handleCellClick(x, y) {
    if (result || thinking || revealing || turn !== playerColor) return;

    const next = applyMove(x, y, playerColor, board);
    setHistory(h => [...h, board]);
    setBoard(next);
    setLastMove([x, y]);
    // 落子的震动反馈已经在 Board 组件"确认落子"那一步震过了,这里不用再震一次

    const win = checkWin(next, x, y);
    if (win) {
      setWinInfo(win.line);
      // 震动反馈立刻给(手感要及时),棋盘上方的结果文字和下方的操作按钮
      // 延迟一点点再切出来,让连线动画先跑起来
      hapticNotify("success");
      scheduleReveal(WIN_REVEAL_DELAY, "win");
      return;
    }
    if (isBoardFull(next)) {
      scheduleReveal(DRAW_REVEAL_DELAY, "draw");
      return;
    }

    setTurn(aiColor);
    performAiMove(next, aiColor, playerColor, difficulty);
  }

  function undo() {
    if (history.length < 1 || thinking || revealing || result) return;
    const prevBoard = history[history.length - 1];
    setBoard(prevBoard);
    setHistory(h => h.slice(0, -1));
    setTurn(playerColor);
    setWinInfo(null);
    setLastMove(null);
  }

  // 还没选边:显示选边界面,不进入棋盘
  // Telegram 自带的返回键已经接了同一个 onExit(见下面的
  // useTelegramBackButton),但普通浏览器里没有这颗原生按键,所以非
  // Telegram 环境下还是要补一个"‹"回去,不然选边界面就成了死胡同。
  if (!playerColor) {
    return (
      <div>
        {!isInTelegram && (
          <div className="room-topbar" style={{ marginBottom: 4 }}>
            <button className="room-icon-btn" onClick={onExit} aria-label="返回">
              <IconChevronLeft />
            </button>
          </div>
        )}
        <div className="side-select fade-in-up">
          <h2 className="side-select-title">选择你执子的颜色</h2>
          <p className="muted side-select-subtitle">黑棋永远先手,执黑就是主动开局</p>

          <button className="side-btn" onClick={() => handleColorSelect(BLACK)}>
            <div className="stone black side-btn-stone" />
            <div className="side-btn-text">
              <div className="side-btn-name">执黑</div>
              <div className="side-btn-desc">先手,主动开局</div>
            </div>
          </button>

          <button className="side-btn" onClick={() => handleColorSelect(WHITE)}>
            <div className="stone white side-btn-stone" />
            <div className="side-btn-text">
              <div className="side-btn-name">执白</div>
              <div className="side-btn-desc">后手,后发制人</div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // 对局结束、连线动画播完之后,整页切换成全屏结算页(PveResultReveal)——
  // 跟联机对战、每日试炼同一套模式,不再是嵌在棋盘上方 74px 小面板里的
  // 一行结果文字。"再来一局"直接调 reset(),不用带难度参数(用当前
  // difficulty state 就行,这里不是切难度触发的重开)。
  if (result && !revealing) {
    return (
      <PveResultReveal
        result={result}
        board={board}
        winLine={winInfo}
        difficulty={difficulty}
        onExitHome={onExitHome}
        onRematch={() => reset()}
      />
    );
  }

  return (
    <div>
      <div className="game-layout">
        {/* 顶部状态栏:回合状态 + 悔棋。Telegram 自带的返回键已经接了同一个
            onExit,所以 Telegram 环境下整条栏目靠右对齐,把左边腾给难度
            选择和结束后的操作按钮;但普通浏览器没有原生返回键,这时候要
            把左边的"‹"画回来,不然对局进行到一半想退出就没有入口了。 */}
        <div className="room-topbar pve-topbar" style={isInTelegram ? { justifyContent: "flex-end" } : undefined}>
          {!isInTelegram && (
            <button className="room-icon-btn" onClick={onExit} aria-label="返回">
              <IconChevronLeft />
            </button>
          )}
          <div className="pve-topbar-right">
            <div className="pve-turn-pill">
              {thinking ? (
                <><div className="spinner" /> AI 思考中</>
              ) : revealing ? (
                <>{winInfo ? "五子连珠!" : "棋盘落满"}</>
              ) : (
                <>
                  <div className={`turn-dot black${turn === BLACK ? " active" : ""}`} />
                  <div className={`turn-dot white${turn === WHITE ? " active" : ""}`} />
                  {turn === playerColor ? "轮到你" : "对方回合"}
                </>
              )}
            </div>
            <button className="btn-undo" onClick={undo} disabled={history.length < 1 || thinking || revealing}>
              <IconUndo size={15} /> 悔棋
            </button>
          </div>
        </div>

        <div className="game-board-col">
          {/* 结果结算不再嵌在这块小面板里——对局结束、揭晓延迟一过,
              整页就切换成 PveResultReveal 全屏结算页了(见上面
              `if (result && !revealing)` 那个提前 return)。这块区域
              固定高度留白,纯粹是为了对局进行中棋盘位置不会跳动,现在
              永远不会显示 result 相关内容,因为走到这里 result 必为空。 */}
          <div className="pve-result-panel" />

          <Board board={board} onCellClick={handleCellClick} lastMove={lastMove} winLine={winInfo} disabled={thinking} locked={revealing} onIllegalTap={() => hapticNotify("warning")} previewColor={playerColor} />
        </div>

        <div className="game-info-col">
          {/* 难度选择常驻显示,不管对局是进行中还是已经结束——结束后如果想
              直接换个难度开新的一局,点了就走,不用先点别的按钮 */}
          <div className="diff-row">
            {[["easy", "简单"], ["medium", "中等"], ["hard", "困难"]].map(([key, label]) => (
              <button
                key={key}
                className={`diff-btn${difficulty === key ? " active" : ""}`}
                onClick={() => handleDifficultyChange(key)}
                disabled={thinking || revealing}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
