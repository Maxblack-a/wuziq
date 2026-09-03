-- ============================================================
-- 每日试炼冷启动种子分:优先用"已经打过的其他 NPC"评分均值,
-- 不再依赖棋风测试快照(复测功能已经去掉,棋风测试不会再被刷新)
-- 在 Supabase 控制台 SQL Editor 里单独运行即可,幂等,重复执行没问题
-- (create or replace,函数签名没变,不需要额外 drop)。
-- ============================================================

create or replace function daily_trial_npc_entry(p_row profiles, p_npc_id text)
returns jsonb
language plpgsql
as $$
declare
  v_entry jsonb;
  v_seed int;
  v_avg numeric;
begin
  v_entry := p_row.daily_trial_npc_stats -> p_npc_id;
  if v_entry is null then
    select avg((v.value->>'rating')::numeric) into v_avg
    from jsonb_each(coalesce(p_row.daily_trial_npc_stats, '{}'::jsonb)) as v
    where coalesce((v.value->>'games_played')::int, 0) > 0;

    if v_avg is not null then
      v_seed := round(v_avg);
    elsif p_row.skill_test_status = 'completed' and p_row.skill_test_hidden_score is not null then
      v_seed := p_row.skill_test_hidden_score;
    else
      v_seed := 50;
    end if;
    v_seed := greatest(0, least(100, v_seed));

    v_entry := jsonb_build_object(
      'rating', v_seed, 'linmo_rating', v_seed,
      'streak', 0, 'best_streak', 0, 'games_played', 0, 'wins', 0
    );
  end if;
  return v_entry;
end;
$$;
