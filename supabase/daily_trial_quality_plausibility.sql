-- ============================================================
-- P1 加固:每日试炼 quality 参数补一道"耗时是否合理"的基础校验
--
-- 背景:session 绑定(daily_trial_session_binding.sql)已经堵住了
-- "凭空调 finish_daily_trial 反复领奖"这条路,但 p_quality 这个参数
-- 本身依然完全由客户端计算、服务端只做 [0,1] clamp——一个懂调试的
-- 玩家依然可以:调 start_daily_trial 拿到 session_id 之后,不真的打
-- 这一局,直接手动调 finish_daily_trial 传 quality=1、result='win'。
--
-- 完整解法是把整套局面评估算法(dailyTrialEngine.js 里 AI 用来判断
-- "这一步是不是最优"的逻辑)搬到服务端重新跑一遍,根据服务端记录的
-- 真实落子重新算 quality——但这是一个独立的大工程,而且每日试炼本身
-- 影响的只是 PVE 单机奖励(exp/diamonds)和评分曲线,不涉及玩家之间
-- 的对战公平性,伤害面有限,不值得现在就上这么重的方案。
--
-- 这里先加一个性价比高的基础校验:一局真实的对局,不可能"开局立刻
-- 结束"——客户端里 NPC 每一步至少有固定的思考延迟(见
-- DailyTrialGameScreen.jsx 的 THINKING_DELAY),几步棋加起来总要花掉
-- 几秒到几十秒。这里按总步数给一个远低于正常水平的耗时下限,主要是
-- 挡"跳过真实对局、直接编数据上报"这种最粗暴的滥用,不是精确验证
-- quality 数值本身的真实性。
-- ============================================================

-- 参数签名变了(多了 p_move_count/p_duration_sec 两个可选参数,用于
-- 耗时合理性校验),先删旧版本,理由同之前几次——旧签名没有这个校验,
-- 留着就是能绕开新检查的后门。
drop function if exists finish_daily_trial(uuid, text, text, numeric);
create or replace function finish_daily_trial(
  p_session_id uuid,
  p_npc_id text,
  p_result text,
  p_quality numeric default 0.5,
  p_move_count int default null,
  p_duration_sec numeric default null
)
returns table (
  out_exp int, out_diamonds int, out_rating int, out_linmo_rating int,
  out_streak int, out_best_streak int
)
language plpgsql
security definer
as $$
declare
  me uuid;
  v_session daily_trial_sessions%rowtype;
  v_row profiles%rowtype;
  v_entry jsonb;
  v_rating int;
  v_linmo int;
  v_streak int;
  v_best_streak int;
  v_games_played int;
  v_wins int;
  v_quality numeric;
  v_expected numeric;
  v_actual numeric;
  v_new_rating int;
  v_new_linmo int;
  v_new_streak int;
  v_new_best_streak int;
  v_new_entry jsonb;
  v_new_calc int;
  v_exp_gain int := 0;
  v_diamond_gain int := 0;
  v_min_duration numeric;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;
  if p_npc_id is null or length(trim(p_npc_id)) = 0 then
    raise exception '缺少棋手标识';
  end if;
  if p_result not in ('win', 'lose', 'draw') then
    raise exception '非法的对局结果';
  end if;

  -- 锁住这个 session,防止同一局的两个并发结算请求同时通过下面的
  -- status='active' 检查(双开、网络重试等场景)。
  select * into v_session from daily_trial_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception '找不到这一局的记录,请通过正常流程开始试炼';
  end if;
  if v_session.player_id <> me then
    raise exception '无权限';
  end if;
  if v_session.npc_id <> p_npc_id then
    raise exception '棋手信息不匹配';
  end if;
  if v_session.status = 'finished' then
    raise exception '这一局已经结算过了';
  end if;
  if v_session.status = 'expired' or now() > v_session.expires_at then
    update daily_trial_sessions set status = 'expired' where id = p_session_id;
    raise exception '这一局已经超时失效,请重新开始';
  end if;

  -- 耗时合理性校验:按步数给一个远低于正常水平的下限(0.4秒/步,
  -- 至少3秒),挡不住精细作弊,但能挡住"开局立刻上报编好的结果"。
  -- moveCount/durationSec 是可选参数(老客户端可能不传),不传时跳过
  -- 这项检查而不是直接拒绝,避免因为客户端版本没跟上而把正常玩家
  -- 挡在外面。
  if p_move_count is not null and p_duration_sec is not null then
    v_min_duration := greatest(3, p_move_count * 0.4);
    if p_duration_sec < v_min_duration then
      raise exception '提交太快,请正常完成对局后再结算';
    end if;
  end if;

  v_quality := greatest(0, least(1, coalesce(p_quality, 0.5)));

  select * into v_row from profiles where id = me for update;

  v_entry := daily_trial_npc_entry(v_row, p_npc_id);
  v_rating := (v_entry->>'rating')::int;
  v_linmo := (v_entry->>'linmo_rating')::int;
  v_streak := (v_entry->>'streak')::int;
  v_best_streak := (v_entry->>'best_streak')::int;
  v_games_played := (v_entry->>'games_played')::int;
  v_wins := (v_entry->>'wins')::int;

  v_expected := 1.0 / (1.0 + power(10, (v_linmo - v_rating) / 25.0));
  v_actual := case p_result when 'win' then 1.0 when 'draw' then 0.5 else 0.0 end;
  v_actual := v_actual * 0.6 + v_quality * 0.4;

  v_new_rating := round(v_rating + 6 * (v_actual - v_expected));
  v_new_rating := greatest(0, least(100, v_new_rating));

  v_new_linmo := round(v_linmo + 0.3 * (v_new_rating - v_linmo));
  v_new_linmo := greatest(0, least(100, v_new_linmo));

  if p_result = 'win' then
    v_new_streak := greatest(1, v_streak + 1);
    v_exp_gain := 5;
    v_diamond_gain := 1;
  elsif p_result = 'lose' then
    v_new_streak := least(-1, v_streak - 1);
  else
    v_new_streak := 0;
  end if;
  v_new_best_streak := greatest(v_best_streak, v_new_streak);

  if v_row.skill_test_status = 'completed' and v_row.skill_test_dims is not null then
    v_new_calc := round(
      coalesce((v_row.skill_test_dims->>'calc')::numeric, 50) * 0.7
      + (v_quality * 100) * 0.3
    );
    v_new_calc := greatest(0, least(100, v_new_calc));
  end if;

  v_new_entry := jsonb_build_object(
    'rating', v_new_rating,
    'linmo_rating', v_new_linmo,
    'streak', v_new_streak,
    'best_streak', v_new_best_streak,
    'games_played', v_games_played + 1,
    'wins', v_wins + (case when p_result = 'win' then 1 else 0 end)
  );

  update profiles set
    exp = profiles.exp + v_exp_gain,
    diamonds = profiles.diamonds + v_diamond_gain,
    daily_trial_npc_stats = jsonb_set(profiles.daily_trial_npc_stats, array[p_npc_id], v_new_entry),
    skill_test_dims = case
      when v_new_calc is not null then jsonb_set(profiles.skill_test_dims, '{calc}', to_jsonb(v_new_calc))
      else profiles.skill_test_dims
    end
  where id = me;

  update daily_trial_sessions set status = 'finished', finished_at = now() where id = p_session_id;

  insert into daily_trial_games (
    player_id, npc_id, result, quality, player_rating_before, player_rating_after,
    linmo_rating_before, linmo_rating_after, exp_awarded, diamonds_awarded, session_id
  ) values (
    me, p_npc_id, p_result, v_quality, v_rating, v_new_rating,
    v_linmo, v_new_linmo, v_exp_gain, v_diamond_gain, p_session_id
  );

  select exp, diamonds
  into out_exp, out_diamonds
  from profiles where id = me;
  out_rating := v_new_rating;
  out_linmo_rating := v_new_linmo;
  out_streak := v_new_streak;
  out_best_streak := v_new_best_streak;

  return next;
end;
$$;

grant execute on function finish_daily_trial(uuid, text, text, numeric, int, numeric) to authenticated;
