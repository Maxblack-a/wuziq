import { useState } from "react";
import MatchRecapBoard from "./MatchRecapBoard";
import Board from "./Board";
import { IconListNumbers, IconMaximize, IconX } from "./Icons";

// 人机练习(PveScreen)结算页——跟联机对战/每日试炼共用同一套
// .result-reveal-* 视觉语言,但这个模式完全不碰账号的经验值/钻石(纯
// 本地对局,不写数据库),所以没有头像/等级/经验条这些身份相关的东西,
// 也没有飞入动画——没有数值变化可"飞"。只留标题、对局回顾卡片(棋盘
// 缩略图 + 手数 + 难度)、底部"返回首页/再来一局"。
const RESULT_COPY = {
  win: { title: "胜利", desc: "五子连珠,漂亮的一局。" },
  lose: { title: "失败", desc: "差一点,再来一局找回来。" },
  draw: { title: "和棋", desc: "棋盘落满,不分胜负。" },
};

const DIFFICULTY_LABEL = { easy: "简单", medium: "中等", hard: "困难" };

function countStones(board) {
  let n = 0;
  for (const row of board) for (const c of row) if (c !== 0) n++;
  return n;
}

export default function PveResultReveal({ result, board, winLine, difficulty, onExitHome, onRematch }) {
  const [showFullBoard, setShowFullBoard] = useState(false);
  const moveCount = countStones(board);

  return (
    <div className="result-reveal-screen">
      <div className="result-reveal-scroll">
        <div className="result-reveal-inner">
          <div className="result-title-zone" style={{ marginTop: "var(--space-6)" }}>
            <div className="result-ornament-row">
              <span className="result-ornament-line" />
              <span className="result-ornament-dot" />
              <span className="result-ornament-line" />
            </div>
            <div className={`result-title ${result}`}>{RESULT_COPY[result].title}</div>
            <div className="result-ornament-row">
              <span className="result-ornament-line" />
              <span className="result-ornament-dot" />
              <span className="result-ornament-line" />
            </div>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>{RESULT_COPY[result].desc}</p>
          </div>

          <div className="result-recap-card" style={{ marginTop: "var(--space-6)" }}>
            <div className="result-recap-title">对局回顾</div>
            {winLine ? (
              <div
                className="result-recap-board-wrap"
                onClick={() => setShowFullBoard(true)}
                role="button"
                tabIndex={0}
                aria-label="查看完整对局"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowFullBoard(true); }}
              >
                <MatchRecapBoard board={board} winLine={winLine} />
                <span className="result-recap-expand-hint"><IconMaximize size={13} /></span>
              </div>
            ) : (
              <div className="result-recap-board-wrap">
                <MatchRecapBoard board={board} winLine={winLine} />
              </div>
            )}
            {winLine && <div className="result-recap-tap-caption">点击查看完整对局</div>}
            <div className="result-recap-divider">
              <span className="result-recap-divider-line" />
              <span className="result-recap-divider-dot" />
              <span className="result-recap-divider-line" />
            </div>
            <div className="result-stats-grid">
              <div className="result-stat-cell">
                <div className="result-stat-cell-icon"><IconListNumbers size={16} /></div>
                <div className="result-stat-cell-value">{moveCount} 手</div>
                <div className="result-stat-cell-label">手数</div>
              </div>
              <div className="result-stat-cell">
                {/* 难度这一格没有对应图标,用一个隐藏的占位图标撑开跟左边
                    "手数"格一样的高度,两格的数字才能对齐在同一条基线上 */}
                <div className="result-stat-cell-icon" style={{ visibility: "hidden" }}><IconListNumbers size={16} /></div>
                <div className="result-stat-cell-value">{DIFFICULTY_LABEL[difficulty] ?? difficulty}</div>
                <div className="result-stat-cell-label">难度</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="result-reveal-footer">
        <div className="result-reveal-footer-row">
          <button className="btn-ghost" onClick={onExitHome}>返回首页</button>
          <button className="btn-primary" onClick={onRematch}>再来一局</button>
        </div>
      </div>

      {showFullBoard && board && (
        <div className="recap-modal-overlay" onClick={() => setShowFullBoard(false)}>
          <div className="recap-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="recap-modal-header">
              <div className="recap-modal-title">完整对局回放</div>
              <button className="recap-modal-close" onClick={() => setShowFullBoard(false)} aria-label="关闭">
                <IconX size={15} />
              </button>
            </div>
            <Board board={board} winLine={winLine} locked onCellClick={() => {}} />
            <div className="recap-modal-footer-text">共 {moveCount} 手</div>
          </div>
        </div>
      )}
    </div>
  );
}
