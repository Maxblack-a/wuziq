-- ============================================================
-- P1 加固:棋力测试 session 化 + 收紧 skill_test_history 的直接写权限
--
-- 背景:submit_skill_test_result() 这个 RPC(security_hardening_p0.sql
-- 加的)已经堵住了"客户端直接 update profiles 改 skill_test_* 字段"
-- 这条路,但它本身还是完全信任客户端传来的 p_dims/p_hidden_score 这些
-- 参数——测试全程(六维风格分怎么算、隐藏水平分多少)都是纯客户端
-- 算完了才报给服务器,服务器没有任何独立验证。也就是说,懂一点前端
-- 调试的人依然可以直接调用这个 RPC,传一组编好的高分数据进去。
--
-- 完整解法是把整个测试过程(每一步棋)搬到服务端重新验证,但这个
-- 工作量很大(要把 skillProfile.js/skillTest.js 里的评分算法整套搬到
-- SQL 里),而且棋力测试本身影响的主要是"每日试炼的冷启动难度"这个
-- 体验层面的东西,不是直接的经济/战绩数据,伤害面有限。
--
-- 这里先做一个性价比更高的中间方案:
--   1) 引入 skill_test_sessions,submit_skill_test_result 必须绑定一个
--      真实存在、属于自己、还没结算过、没过期的 session——至少保证
--      "调用这个 RPC 之前必须先真的开始过一次测试",不能凭空捏造。
--   2) 加一个"耗时是否合理"的基础校验:一次完整测试至少要走过若干步
--      棋、花掉至少若干秒,不能"刚开始立刻交卷"。这挡不住"认真下但
--      故意乱下来刷分"这种精细作弊,但能挡住最粗暴的脚本化滥用。
--   3) skill_test_history 的 insert 策略原来允许客户端直接
--      auth.uid() = profile_id 就能插入,顺手收紧成只能通过这个 RPC
--      写(RPC 本身是 security definer,不受这条收紧影响)。
--
-- 如果以后想做成"服务端完全重新验证",可以在这个基础上升级:
-- submit_skill_test_result 里不再直接信任 p_dims/p_hidden_score,而是
-- 拿 p_raw 里的 moves/checkpoints 在 SQL 里重新跑一遍
-- skillProfile.js 的评分逻辑再落库——但那是一个独立的大工程,建议先
-- 用这个中间方案顶着。
-- ============================================================

-- ------------------------------------------------------------
-- 1) skill_test_sessions 表
-- ------------------------------------------------------------
create table if not exists skill_test_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished', 'expired')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 棋力测试比每日试炼一局耗时更长(最多 40 步/方),给足 60 分钟窗口。
  expires_at timestamptz not null default (now() + interval '60 minutes')
);

alter table skill_test_sessions enable row level security;
drop policy if exists "skill_test_sessions_select" on skill_test_sessions;
create policy "skill_test_sessions_select" on skill_test_sessions for select using (auth.uid() = player_id);
-- 没有 insert/update policy:只由 start_skill_test / submit_skill_test_result
-- (都是 security definer)读写。

create index if not exists skill_test_sessions_active_idx
  on skill_test_sessions(player_id, status) where status = 'active';


-- ------------------------------------------------------------
-- 2) start_skill_test:开始测试时落一行 session,返回 session_id
-- ------------------------------------------------------------
create or replace function start_skill_test()
returns uuid
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_session_id uuid;
begin
  if me is null then
    raise exception '未登录';
  end if;

  insert into skill_test_sessions (player_id, status)
  values (me, 'active')
  returning id into v_session_id;

  return v_session_id;
end;
$$;

grant execute on function start_skill_test() to authenticated;


-- ------------------------------------------------------------
-- 3) submit_skill_test_result:必须带着 session_id,校验通过后立刻
--    标记 finished,同一个 session 不能提交两次结果
-- ------------------------------------------------------------
-- 参数签名变了(多了必填的 p_session_id 和 p_move_count/p_duration_sec
-- 这两个用于耗时合理性校验的字段),先删旧版本,理由同之前几次加固
-- ——旧签名没有这些校验,留着就是现成的后门。
drop function if exists submit_skill_test_result(jsonb, text, int, text, jsonb);
create or replace function submit_skill_test_result(
  p_session_id uuid,
  p_dims jsonb,
  p_type text,
  p_hidden_score int,
  p_confidence text,
  p_raw jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_session skill_test_sessions%rowtype;
  v_move_count int;
  v_elapsed_sec numeric;
  v_min_elapsed_sec numeric;
begin
  if me is null then raise exception '未登录'; end if;

  select * into v_session from skill_test_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception '找不到这次测试的记录,请通过正常流程开始棋力测试';
  end if;
  if v_session.player_id <> me then
    raise exception '无权限';
  end if;
  if v_session.status = 'finished' then
    raise exception '这次测试已经提交过结果了';
  end if;
  if v_session.status = 'expired' or now() > v_session.expires_at then
    update skill_test_sessions set status = 'expired' where id = p_session_id;
    raise exception '这次测试已经超时失效,请重新开始';
  end if;

  -- 耗时合理性校验:一次真实的测试,双方每一步之间客户端至少有
  -- 500ms 的强制思考延迟(见 SkillTestScreen.jsx 的 THINKING_DELAY),
  -- 这里按总步数 * 0.4 秒 给一个远低于正常水平的下限,主要是挡
  -- "开局立刻交卷"这种最粗暴的脚本化滥用,不是精确验证。
  v_move_count := coalesce(jsonb_array_length(p_raw->'moves'), 0);
  v_elapsed_sec := extract(epoch from (now() - v_session.created_at));
  v_min_elapsed_sec := greatest(3, v_move_count * 0.4);

  if v_move_count = 0 then
    raise exception '没有有效的落子记录';
  end if;
  if v_elapsed_sec < v_min_elapsed_sec then
    raise exception '提交太快,请正常完成测试后再提交';
  end if;

  update profiles set
    skill_test_status = 'completed',
    skill_test_dims = p_dims,
    skill_test_type = p_type,
    skill_test_hidden_score = p_hidden_score,
    skill_test_confidence = p_confidence,
    skill_test_raw = p_raw,
    skill_test_completed_at = now()
  where id = me;

  insert into skill_test_history (profile_id, dims, type, hidden_score, confidence)
  values (me, p_dims, p_type, p_hidden_score, p_confidence);

  update skill_test_sessions set status = 'finished', finished_at = now() where id = p_session_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function submit_skill_test_result(uuid, jsonb, text, int, text, jsonb) to authenticated;


-- ------------------------------------------------------------
-- 4) skill_test_history 收紧:不再允许客户端直接 insert,只能通过
--    上面这个 RPC 写(RPC 是 security definer,不受这条影响)
-- ------------------------------------------------------------
drop policy if exists "skill_test_history_insert" on skill_test_history;


-- ------------------------------------------------------------
-- 5) 顺手清一下过期/结算完的 session
-- ------------------------------------------------------------
create or replace function cleanup_stale_skill_test_sessions()
returns void
language plpgsql
security definer
as $$
begin
  update skill_test_sessions
  set status = 'expired'
  where status = 'active' and now() > expires_at;

  delete from skill_test_sessions
  where status in ('finished', 'expired') and created_at < now() - interval '7 days';
end;
$$;

do $$
begin
  perform cron.unschedule('cleanup-stale-skill-test-sessions');
exception when others then
  null;
end $$;

select cron.schedule('cleanup-stale-skill-test-sessions', '*/30 * * * *', $$select cleanup_stale_skill_test_sessions();$$);
