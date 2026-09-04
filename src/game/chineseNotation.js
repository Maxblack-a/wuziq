// 中国象棋标准记谱法:"炮二平五""马八进七"这类三字/四字记法。
// ------------------------------------------------------------
// 规则要点(跟通行棋谱记法一致):
//   1. 纵线编号双方各算各的——红方从右到左数 1-9,黑方从右到左数 1-9,
//      但"右"是相对棋手自己的视角来说的:红方在棋盘下方,他的"右边"
//      是屏幕上的左边(x 小的一侧);黑方在棋盘上方,他的"右边"是屏幕上
//      的右边(x 大的一侧)。所以红方 x=0(最左列)记为"九",x=8 记为
//      "一";黑方反过来,x=0 记为"一",x=8 记为"九"。
//   2. 同一纵线上有多个同类棋子时,用"前/后"区分,比如"前车进一"。
//      这份实现覆盖到两个同类棋子的情况(实战最常见),三个以上的罕见
//      多子情况(比如三兵未过河排一线)简化处理,不强行区分前中后。
//   3. 动作用字:同一纵线内前进用"进"、后退用"退";横向移动用"平"。
//      对车/炮/兵(卒)/将(帅)这类走直线的子,"进/退 N"里的 N 是纵向
//      移动的步数(格数);对马/相(象)/仕(士)这类斜走的子,"进/退"后面
//      跟的不是步数,是"目标纵线的编号"(棋谱记法的老规矩,新手常常
//      记混,但这是标准写法)。
//   4. 数字用中文一二三四五六七八九,不用阿拉伯数字。
import { pieceType, pieceColor, RED, SHUAI, SHI, XIANG, MA, CHE, PAO, BING } from "./xiangqiLogic";

const CN_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const PIECE_CHAR = {
  [SHUAI]: { [RED]: "帅", [-RED]: "将" },
  [SHI]: { [RED]: "仕", [-RED]: "士" },
  [XIANG]: { [RED]: "相", [-RED]: "象" },
  [MA]: { [RED]: "马", [-RED]: "马" },
  [CHE]: { [RED]: "车", [-RED]: "车" },
  [PAO]: { [RED]: "炮", [-RED]: "炮" },
  [BING]: { [RED]: "兵", [-RED]: "卒" },
};

// 某一列在“执子一方视角”里的编号(1-9)
function fileNumber(x, color) {
  return color === RED ? 9 - x : x + 1;
}

// boardBeforeMove:走这步之前的棋盘(用来判断纵线上还有没有同类棋子、
// 找同类棋子的位置),from/to 是这步棋的起止坐标。
export function moveToChineseNotation(boardBeforeMove, from, to) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const piece = boardBeforeMove[fy][fx];
  if (!piece) return "";
  const color = pieceColor(piece);
  const type = pieceType(piece);
  const char = PIECE_CHAR[type][color] || "?";
  const startFile = fileNumber(fx, color);
  const endFile = fileNumber(tx, color);

  // 同一纵线上是否还有另一枚同类型同颜色的棋子——决定要不要加"前/后"
  const sameFileMates = [];
  for (let y = 0; y < 10; y++) {
    const p = boardBeforeMove[y][fx];
    if (p !== 0 && pieceColor(p) === color && pieceType(p) === type) sameFileMates.push(y);
  }
  // 注意:用文件编号时是"棋子名 + 编号"(炮二),但用前/后区分时顺序倒过来,
  // 是"前/后 + 棋子名"(前炮)——这是记谱法本身的不对称规则,不是拼写随意,
  // 两种前缀不能套用同一个"棋子名在前"的模板。
  let head; // 最终拼出来的"棋子名+定位"这一段
  if (sameFileMates.length >= 2) {
    const sorted = [...sameFileMates].sort((a, b) => (color === RED ? a - b : b - a));
    const rank = sorted.indexOf(fy); // 0=前
    const posWord = sameFileMates.length === 2
      ? (rank === 0 ? "前" : "后")
      : (rank === 0 ? "前" : rank === sorted.length - 1 ? "后" : "中");
    head = `${posWord}${char}`;
  } else {
    head = `${char}${CN_NUM[startFile]}`;
  }

  const forwardSteps = color === RED ? fy - ty : ty - fy; // 正数=前进

  let verb, target;
  const straightLine = [SHUAI, CHE, PAO, BING].includes(type);
  if (straightLine) {
    if (fx === tx) {
      verb = forwardSteps > 0 ? "进" : "退";
      target = CN_NUM[Math.abs(forwardSteps)];
    } else {
      verb = "平";
      target = CN_NUM[endFile];
    }
  } else {
    // 马/相(象)/仕(士):斜线走子,进退后面跟的是目标纵线编号,不是步数
    verb = forwardSteps > 0 ? "进" : forwardSteps < 0 ? "退" : "平";
    target = CN_NUM[endFile];
  }

  return `${head}${verb}${target}`;
}
