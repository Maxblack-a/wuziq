// 每日试炼的后端读写,全部走 supabase/schema.sql 里定义的三个
// security definer 函数——体力扣减、评分/经验值/钻石结算都要在服务器
// 端原子完成,不能让客户端自己算完直接 update profiles(不然刷体力、
// 刷钻石只是改改前端代码的事)。这个文件只是薄薄一层 RPC 包装,
// 不含任何游戏规则本身。
import { supabase } from "./supabase";

// 进每日试炼首页/挑战前调用:顺手处理"今天是不是新的一天,体力该不该
// 刷新"这件事,拿到的是刷新之后的最新状态,用来渲染体力条/连胜徽章。
// npcId 必填——评分/连胜/战绩现在按棋手分开存了(见 schema.sql 的
// daily_trial_npc_stats),同一个账号跟林墨打出来的连胜和跟苏晴打出来
// 的连胜是两码事,不传 npcId 服务器直接会报错,不会给一个含糊的默认值。
export async function getDailyTrialStatus(npcId) {
  const { data, error } = await supabase.rpc("get_daily_trial_status", { p_npc_id: npcId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    stamina: row.out_stamina,
    diamonds: row.out_diamonds,
    rating: row.out_rating,
    linmoRating: row.out_linmo_rating,
    streak: row.out_streak,
    bestStreak: row.out_best_streak,
    gamesPlayed: row.out_games_played,
    wins: row.out_wins,
  };
}

// 点"挑战"那一刻调用:服务器校验体力够不够、扣掉这一局的体力,
// 返回当前的评分/对手评分——前端拿这两个分数去初始化这一局的强度旋钮。
// 体力不够时 RPC 会直接抛错('体力不足'),调用方 catch 住给提示即可。
// npcId 必填,理由同上;这也是"跟这位棋手的评分条目"第一次真正落库
// 的时刻(还没打过就是冷启动值,打过就是上次结算之后的值)。
// 返回值里现在多了 sessionId——这是这一局在服务端 daily_trial_sessions
// 表里的凭证,调用方必须把它原样存起来,结束时传给 finishDailyTrial。
// 没有它,finish_daily_trial 会直接拒绝结算(见
// supabase/daily_trial_session_binding.sql),不再存在"没开过局也能
// 领奖"或者"同一局领两次"的口子。
export async function startDailyTrial(npcId) {
  const { data, error } = await supabase.rpc("start_daily_trial", { p_npc_id: npcId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    stamina: row.out_stamina,
    diamonds: row.out_diamonds,
    rating: row.out_rating,
    linmoRating: row.out_linmo_rating,
    streak: row.out_streak,
    sessionId: row.out_session_id,
  };
}

// 对局结束调用:result 是 'win' | 'lose' | 'draw',quality 是这一局
// 算出来的 0-1 局面质量分(见 game/dailyTrialEngine.js 的
// computeMatchQuality)——服务器会把这个值 clamp 到 [0,1] 再用,
// 不完全信任客户端传来的原始数字,但仍然拿它当评分更新的一个输入,
// 让"每日试炼的隐藏分"不只是单纯的胜负记录,还能反映过程表现。
// npcId 必填,决定这一局记到哪位棋手名下,理由同上。
// sessionId 必填——必须是 startDailyTrial 刚刚返回的那个,服务器会校验
// 它属于当前用户、对应同一个 npcId、状态还是 active 且没过期,校验不过
// 会直接抛错,调用方需要 catch 住给提示(比如引导玩家重新开始这一局)。
export async function finishDailyTrial(sessionId, npcId, result, quality) {
  const { data, error } = await supabase.rpc("finish_daily_trial", {
    p_session_id: sessionId,
    p_npc_id: npcId,
    p_result: result,
    p_quality: quality,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    exp: row.out_exp,
    diamonds: row.out_diamonds,
    rating: row.out_rating,
    linmoRating: row.out_linmo_rating,
    streak: row.out_streak,
    bestStreak: row.out_best_streak,
  };
}
