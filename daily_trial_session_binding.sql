-- ============================================================
-- P1 安全加固:每日试炼 session 化,堵住"凭空调 finish_daily_trial
-- 领奖/反复领奖"的口子。
--
-- 背景:start_daily_trial 会扣体力,但扣完之后没有留下任何"这一局
-- 存在"的凭证——finish_daily_trial 只看 npc_id/result/quality 三个
-- 客户端自己传的参数就直接发奖励、改评分。这意味着不开一局也能反复
-- 调 finish_daily_trial 白嫖 exp/diamonds,而且没有开始过某一局也能
-- 谎报 result='win' 直接领。
--
-- 修法:引入 daily_trial_sessions 表,start_daily_trial 开局时插一行
-- status='active' 的记录并把 id 返回给客户端;finish_daily_trial 必须
-- 带着这个 session_id 来,服务端校验"这个 session 存在 / 是我的 /
-- 还没结算过 / 没过期 / npc 对得上",校验通过后立刻把它标成 finished
-- ——同一个 session 只能成功结算一次,而且必须先有对应的 start 调用
-- 才可能存在这个 session。
--
-- 在 Supabase 控制台 SQL Editor 里,schema.sql 和 security_hardening_p0.sql
-- 都跑完之后再运行这个文件。
-- ============================================================

-- ------------------------------------------------------------
-- 1) daily_trial_sessions 表
-- ------------------------------------------------------------
create table if not exists daily_trial_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  npc_id text not null,
  status text not null default 'active' check (status in ('active', 'finished', 'expired')),
  player_rating_before int,
  linmo_rating_before int,
  stamina_cost int not null default 5,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 15 分钟内没结算就视为过期,防止 sessions 表被"开局不打"的行为
  -- 无限堆积,也避免很久以前开的一局评分快照拿来结算时早就对不上了。
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

alter table daily_trial_sessions enable row level security;
drop policy if exists "daily_trial_sessions_select" on daily_trial_sessions;
create policy "daily_trial_sessions_select" on daily_trial_sessions for select using (auth.uid() = player_id);
-- 没有 insert/update policy:这张表只由 start_daily_trial / finish_daily_trial
-- (都是 security definer)读写,客户端不能直接插一行伪造"我开过局"。

create index if not exists daily_trial_sessions_active_idx
  on daily_trial_sessions(player_id, status) where status = 'active';

-- daily_trial_games 补一列,方便以后从战绩表反查是哪个 session 结算出来的
-- (老数据没有这一列的值,留 null,不能倒推,含义同 npc_id 那一列的历史注释)。
alter table daily_trial_games add column if not exists session_id uuid references daily_trial_sessions(id);


-- ------------------------------------------------------------
-- 2) start_daily_trial:开局时落一行 session,返回 session_id
-- ------------------------------------------------------------
-- 返回类型变了(多了 out_session_id),先删旧版本,理由同 schema.sql 里
-- 其余"参数/返回类型一变就要显式 drop"的地方——create or replace
-- 只能替换签名完全一致的函数,签名不一样会变成重载,旧版本会留在库里,
-- 旧版本没有 session 校验,等于给绕过 finish_daily_trial 新校验开了后门。
drop function if exists start_daily_trial(text, int);
create or replace function start_daily_trial(p_npc_id text, p_stamina_cost int default 5)
returns table (
  out_stamina int, out_diamonds int, out_rating int, out_linmo_rating int,
  out_streak int, out_session_id uuid
)
language plpgsql
security definer
as $$
declare
  me uuid;
  v_row profiles%rowtype;
  v_entry jsonb;
  v_session_id uuid;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;
  if p_npc_id is null or length(trim(p_npc_id)) = 0 then
    raise exception '缺少棋手标识';
  end if;

  perform ensure_daily_reset(me);

  select * into v_row from profiles where id = me for update;

  if v_row.stamina < p_stamina_cost then
    raise exception '体力不足';
  end if;

  v_entry := daily_trial_npc_entry(v_row, p_npc_id);

  update profiles set
    stamina = profiles.stamina - p_stamina_cost,
    daily_trial_npc_stats = jsonb_set(profiles.daily_trial_npc_stats, array[p_npc_id], v_entry)
  where id = me;

  -- 玩家上一局如果开了没打完就退出了,这里不用管——那些行留着 status
  -- 仍是 'active'、后面自然会因为 expires_at 过期而结算不了,不影响
  -- 这一局重新开一个新的 session。
  insert into daily_trial_sessions (player_id, npc_id, status, player_rating_before, linmo_rating_before, stamina_cost)
  values (me, p_npc_id, 'active', (v_entry->>'rating')::int, (v_entry->>'linmo_rating')::int, p_stamina_cost)
  returning id into v_session_id;

  out_stamina := v_row.stamina - p_stamina_cost;
  out_diamonds := v_row.diamonds;
  out_rating := (v_entry->>'rating')::int;
  out_linmo_rating := (v_entry->>'linmo_rating')::int;
  out_streak := (v_entry->>'streak')::int;
  out_session_id := v_session_id;

  return next;
end;
$$;

grant execute on function start_daily_trial(text, int) to authenticated;


-- ------------------------------------------------------------
-- 3) finish_daily_trial:必须带着 start_daily_trial 发的 session_id 来,
--    校验通过后立刻把 session 标记 finished,同一个 session 只能领一次
-- ------------------------------------------------------------
-- 参数签名变了(多了必填的 p_session_id),先删旧版本,理由同上——旧签名
-- 没有 session 校验,不删掉就是一个能绕开新校验直接领奖的后门。
drop function if exists finish_daily_trial(text, text, numeric);
create or replace function finish_daily_trial(
  p_session_id uuid,
  p_npc_id text,
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

  -- session 标记结算完成,同一个 session_id 之后再来一次会在上面
  -- status='finished' 那个检查直接被拒绝,不会重复发奖励。
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

grant execute on function finish_daily_trial(uuid, text, text, numeric) to authenticated;


-- ------------------------------------------------------------
-- 4) 顺手清一下过期/结算完的 session,别让这张表无限增长
-- ------------------------------------------------------------
create or replace function cleanup_stale_daily_trial_sessions()
returns void
language plpgsql
security definer
as $$
begin
  update daily_trial_sessions
  set status = 'expired'
  where status = 'active' and now() > expires_at;

  -- 结算完/过期的 session 留 7 天方便排查问题,之后清掉
  delete from daily_trial_sessions
  where status in ('finished', 'expired') and created_at < now() - interval '7 days';
end;
$$;

do $$
begin
  perform cron.unschedule('cleanup-stale-daily-trial-sessions');
exception when others then
  null; -- 第一次跑的时候还没有这个任务,忽略
end $$;

select cron.schedule('cleanup-stale-daily-trial-sessions', '*/30 * * * *', $$select cleanup_stale_daily_trial_sessions();$$);
