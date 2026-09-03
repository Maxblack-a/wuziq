-- ============================================================
-- 每日试炼:每局同步更新棋风画像的"计算力"这一维(轻量版)
-- 在 Supabase 控制台 SQL Editor 里单独运行这一段即可,
-- 内容跟 schema.sql 里 finish_daily_trial 函数最新版完全一致,
-- 重复运行也安全(create or replace)。
--
-- 背景:每日试炼每局都会往 daily_trial_rating(类 ELO 棋力值)里喂
-- 数据,但棋风测试的六维画像(skill_test_dims)在此之前完全没有被
-- 每日试炼碰过——不管玩家每天打多少局,画像永远只反映最近一次专门
-- 做棋风测试那一局的表现。
--
-- 这段只更新"计算力"这一维,用滑动平均(旧值权重 0.7、新局权重 0.3):
-- 每日试炼那一局的"落子质量"(实际选点/理论最优选点的比值,跟
-- skillProfile.js 的 calcScore 同一个口径)当新样本喂进去。只在玩家
-- 已经做过棋风测试(skill_test_status = 'completed')时生效,不给
-- 没测过的人凭空生造一份只有一维有数据的画像;也不动其他五维——
-- 进攻力/防守力/布局感这些依赖棋风测试特有的关卡触发机制,每日试炼
-- 场景下拿不到对应信号。
-- ============================================================

create or replace function finish_daily_trial(
  p_result text,
  p_quality numeric default 0.5
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
  v_row profiles%rowtype;
  v_quality numeric;
  v_expected numeric;
  v_actual numeric;
  v_new_rating int;
  v_new_linmo int;
  v_new_streak int;
  v_new_calc int;
  v_exp_gain int := 0;
  v_diamond_gain int := 0;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;
  if p_result not in ('win', 'lose', 'draw') then
    raise exception '非法的对局结果';
  end if;

  v_quality := greatest(0, least(1, coalesce(p_quality, 0.5)));

  select * into v_row from profiles where id = me for update;

  v_expected := 1.0 / (1.0 + power(10, (v_row.linmo_rating - v_row.daily_trial_rating) / 25.0));
  v_actual := case p_result when 'win' then 1.0 when 'draw' then 0.5 else 0.0 end;
  v_actual := v_actual * 0.6 + v_quality * 0.4;

  v_new_rating := round(v_row.daily_trial_rating + 6 * (v_actual - v_expected));
  v_new_rating := greatest(0, least(100, v_new_rating));

  v_new_linmo := round(v_row.linmo_rating + 0.3 * (v_new_rating - v_row.linmo_rating));
  v_new_linmo := greatest(0, least(100, v_new_linmo));

  if p_result = 'win' then
    v_new_streak := greatest(1, v_row.daily_trial_streak + 1);
    v_exp_gain := 5;
    v_diamond_gain := 1;
  elsif p_result = 'lose' then
    v_new_streak := least(-1, v_row.daily_trial_streak - 1);
  else
    v_new_streak := 0;
  end if;

  if v_row.skill_test_status = 'completed' and v_row.skill_test_dims is not null then
    v_new_calc := round(
      coalesce((v_row.skill_test_dims->>'calc')::numeric, 50) * 0.7
      + (v_quality * 100) * 0.3
    );
    v_new_calc := greatest(0, least(100, v_new_calc));
  end if;

  update profiles set
    exp = profiles.exp + v_exp_gain,
    diamonds = profiles.diamonds + v_diamond_gain,
    daily_trial_rating = v_new_rating,
    linmo_rating = v_new_linmo,
    daily_trial_streak = v_new_streak,
    daily_trial_best_streak = greatest(profiles.daily_trial_best_streak, v_new_streak),
    daily_trial_games_played = profiles.daily_trial_games_played + 1,
    daily_trial_wins = profiles.daily_trial_wins + (case when p_result = 'win' then 1 else 0 end),
    skill_test_dims = case
      when v_new_calc is not null then jsonb_set(profiles.skill_test_dims, '{calc}', to_jsonb(v_new_calc))
      else profiles.skill_test_dims
    end
  where id = me;

  insert into daily_trial_games (
    player_id, result, quality, player_rating_before, player_rating_after,
    linmo_rating_before, linmo_rating_after, exp_awarded, diamonds_awarded
  ) values (
    me, p_result, v_quality, v_row.daily_trial_rating, v_new_rating,
    v_row.linmo_rating, v_new_linmo, v_exp_gain, v_diamond_gain
  );

  select exp, diamonds, daily_trial_rating, linmo_rating, daily_trial_streak, daily_trial_best_streak
  into out_exp, out_diamonds, out_rating, out_linmo_rating, out_streak, out_best_streak
  from profiles where id = me;

  return next;
end;
$$;

-- ============================================================
-- 冷启动同步(上一次的修复,一并保留在这份文件里方便一次跑全)
-- ============================================================

create or replace function sync_daily_trial_rating_from_skill_test()
returns trigger as $$
begin
  if new.skill_test_status = 'completed'
     and (old.skill_test_status is distinct from 'completed')
     and coalesce(new.daily_trial_games_played, 0) = 0
     and new.skill_test_hidden_score is not null
  then
    new.daily_trial_rating := greatest(0, least(100, new.skill_test_hidden_score));
    new.linmo_rating := greatest(0, least(100, new.skill_test_hidden_score));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_sync_daily_trial_rating on profiles;
create trigger trg_profiles_sync_daily_trial_rating before update on profiles
for each row execute function sync_daily_trial_rating_from_skill_test();

-- 一次性回填:补上"这个触发器上线之前"就已经测完棋风测试、但还没打过
-- 每日试炼的老玩家——不然他们会一直卡在默认的 50 分,永远享受不到这次
-- 修复。只挑 daily_trial_rating 仍是默认值 50(=从没被真实对局改过)
-- 且 games_played = 0 的行动手,已经打过对局、评分已经是真实数据的
-- 玩家不会被这条语句碰到。
update profiles
set daily_trial_rating = greatest(0, least(100, skill_test_hidden_score)),
    linmo_rating = greatest(0, least(100, skill_test_hidden_score))
where skill_test_status = 'completed'
  and skill_test_hidden_score is not null
  and coalesce(daily_trial_games_played, 0) = 0
  and daily_trial_rating = 50
  and linmo_rating = 50;
