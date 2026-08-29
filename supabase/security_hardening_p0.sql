-- ============================================================
-- P0 安全加固:
--   1) 服务端权威判定胜负,不再信任客户端上报的 winner
--   2) profiles 系统字段(exp/棋力测试结果/每日试炼数据等)禁止
--      客户端直接 UPDATE,只能通过对应 RPC 写入
-- 在 Supabase 控制台 SQL Editor 里,schema.sql 跑完之后再整段运行这个文件
-- ============================================================

-- ------------------------------------------------------------
-- 1) 服务端权威判定胜负
-- ------------------------------------------------------------

-- 从最后落下的这一子出发,往四个方向数有没有连成 5 个或以上同色棋子。
-- 逻辑跟 src/game/logic.js 里的 checkWin 保持一致(允许长连,≥5 即算赢),
-- 这样服务端和客户端的"是否获胜"判断不会出现分歧。
create or replace function check_five_in_a_row(p_board jsonb, p_x int, p_y int, p_slot int)
returns boolean
language plpgsql
immutable
as $$
declare
  dirs int[][] := array[[1,0],[0,1],[1,1],[1,-1]];
  i int;
  dx int;
  dy int;
  cnt int;
  x int;
  y int;
begin
  if p_slot is null or p_slot = 0 then
    return false;
  end if;

  for i in 1..4 loop
    dx := dirs[i][1];
    dy := dirs[i][2];
    cnt := 1;

    x := p_x + dx; y := p_y + dy;
    while x >= 0 and x < 15 and y >= 0 and y < 15
      and (p_board->>(y * 15 + x))::int = p_slot loop
      cnt := cnt + 1;
      x := x + dx; y := y + dy;
    end loop;

    x := p_x - dx; y := p_y - dy;
    while x >= 0 and x < 15 and y >= 0 and y < 15
      and (p_board->>(y * 15 + x))::int = p_slot loop
      cnt := cnt + 1;
      x := x - dx; y := y - dy;
    end loop;

    if cnt >= 5 then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- make_move 现在自己判定胜负/平局,并在同一次事务里直接调用
-- _finish_match_internal 完成结算——不再依赖客户端另外调 finish_match
-- 上报 winner。落子和判负发生在同一份服务端权威棋盘上,客户端算出来的
-- "我赢了"只用来做本地动画,不再具备任何写库效力。
create or replace function make_move(p_room_id uuid, p_x int, p_y int, p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
  my_slot int;
  idx int;
  v_board jsonb; -- 原来叫 board,跟 rooms.board 这一列同名,导致 update 语句里
                  -- "set board = board" 被判定成有歧义(ambiguous),每次落子必然
                  -- 报错 "column reference \"board\" is ambiguous"——改名避免撞列名
  cell int;
  new_move_count int;
  settlement jsonb;
begin
  if me is null then raise exception '未登录'; end if;
  perform _validate_session(p_session_id);

  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then return jsonb_build_object('error', '无权限'); end if;
  if r.status <> 'playing' then return jsonb_build_object('error', '对局不在进行中'); end if;
  if r.undo_requested_by is not null then return jsonb_build_object('error', '有悔棋请求待处理'); end if;

  my_slot := case when me = r.player1_id then 1 else 2 end;
  if r.current_turn <> my_slot then return jsonb_build_object('error', '还没轮到你'); end if;
  if p_x < 0 or p_x >= 15 or p_y < 0 or p_y >= 15 then return jsonb_build_object('error', '坐标越界'); end if;

  idx := p_y * 15 + p_x; -- 前端 flat 数组是 y*BOARD_SIZE+x,跟 logic.js toBoard2D 保持一致
  v_board := r.board;
  cell := (v_board->>idx)::int; -- ->> 按下标取值再转text,jsonb array直接转int会报错,得先转text
  if cell <> 0 then return jsonb_build_object('error', '这一格已经有子了'); end if;

  v_board := jsonb_set(v_board, array[idx::text], to_jsonb(my_slot));
  new_move_count := r.move_count + 1;

  update rooms set
    board = v_board,
    current_turn = case when my_slot = 1 then 2 else 1 end,
    move_count = new_move_count,
    board_before_last_move = r.board,
    undo_requested_by = null,
    turn_deadline = now() + interval '30 seconds',
    player1_last_seen = case when my_slot = 1 then now() else player1_last_seen end,
    player2_last_seen = case when my_slot = 2 then now() else player2_last_seen end
  where id = p_room_id;

  if check_five_in_a_row(v_board, p_x, p_y, my_slot) then
    settlement := _finish_match_internal(p_room_id, my_slot, 'normal');
    return jsonb_build_object(
      'ok', true, 'move_count', new_move_count,
      'game_status', 'finished', 'winner', my_slot, 'settlement', settlement
    );
  end if;

  if new_move_count >= 225 then
    settlement := _finish_match_internal(p_room_id, 0, 'normal');
    return jsonb_build_object(
      'ok', true, 'move_count', new_move_count,
      'game_status', 'finished', 'winner', 0, 'settlement', settlement
    );
  end if;

  return jsonb_build_object('ok', true, 'move_count', new_move_count, 'game_status', 'playing');
end;
$$;

grant execute on function make_move(uuid, int, int, uuid) to authenticated;

-- 公开的 finish_match 现在只接受"认输"和"判对方掉线负"这两种玩家主动
-- 触发、且天然只能伤害自己利益的结局,真正的胜负(五连/平局)判定全部
-- 收回到上面 make_move 内部,不再对外暴露"我说我赢了就赢了"的入口。
-- 赢家/输家也不再听客户端传的 p_winner,由服务端根据 p_reason 自己算,
-- 这样即使有人篡改请求体里的 p_winner 也不会有任何效果。
create or replace function finish_match(p_room_id uuid, p_winner int, p_reason text default 'normal', p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
  my_slot int;
  opp_slot int;
  opp_last timestamptz;
begin
  if me is null then return jsonb_build_object('error', '未登录'); end if;

  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then
    return jsonb_build_object('error', '无权限操作该对局');
  end if;

  perform _validate_session(p_session_id);

  if r.status = 'finished' then
    return jsonb_build_object('already_finished', true);
  end if;

  my_slot := case when me = r.player1_id then 1 else 2 end;
  opp_slot := case when my_slot = 1 then 2 else 1 end;

  if p_reason = 'forfeit' then
    -- 认输:赢家只能是对手,跟客户端传的 p_winner 无关
    return _finish_match_internal(p_room_id, opp_slot, 'forfeit');
  elsif p_reason = 'disconnect' then
    -- 判对方掉线负:必须对方心跳确实超过宽限时间才允许,不能凭空点一下
    -- 就把自己判赢——宽限阈值跟 check_timeouts 的兜底扫描保持一致。
    opp_last := coalesce(
      case when opp_slot = 1 then r.player1_last_seen else r.player2_last_seen end,
      r.updated_at
    );
    if now() - opp_last < interval '45 seconds' then
      return jsonb_build_object('error', '对方还在线,暂时不能判定掉线');
    end if;
    return _finish_match_internal(p_room_id, my_slot, 'disconnect');
  else
    -- 'normal'(五连/平局)以及其他任何取值一律拒绝——这类结算只能由
    -- make_move 检测到棋盘上真的连成五子/满盘之后在服务端内部触发。
    return jsonb_build_object('error', '不支持的结算方式,请通过正常落子结算对局');
  end if;
end;
$$;

grant execute on function finish_match(uuid, int, text, uuid) to authenticated;


-- ------------------------------------------------------------
-- 2) profiles 系统字段禁止客户端直接 UPDATE
-- ------------------------------------------------------------

-- Postgres 的列级权限:UPDATE 权限可以精确到"哪些列"。先把 authenticated
-- 角色原来(通过 RLS policy 拿到的)对 profiles 整行的 UPDATE 权限收窄,
-- 只保留真正允许玩家自己改的三个展示/账号态字段;exp、wins/losses/draws、
-- diamonds、stamina、skill_test_*、daily_trial_*、active_session_id 这些
-- "系统字段"从今往后只能通过对应的 SECURITY DEFINER RPC 写入——RLS policy
-- (using auth.uid() = id)只回答"能不能改这一行",列级权限才回答
-- "这一行里,能改哪几列",两层缺一不可。
revoke update on profiles from authenticated;
grant update (display_name, avatar_url, nickname_confirmed) on profiles to authenticated;

-- 棋力测试结果的唯一合法写入入口。客户端仍然在本地跑完六维测试算法,
-- 但现在必须把结果交给这个 RPC 写库,而不是自己拼一个 update 对象直接
-- 打 profiles 表——RPC 内部逻辑跟原来 App.jsx 里那段客户端代码等价,
-- 只是换了个可信的执行位置。
-- 注:这是"防止随手改库"级别的加固,不是"防止有人本地跑一遍测试算法
-- 时故意让它算出更高的分"——真正堵住后者需要文档里提到的把测试过程
-- session 化、由服务端记录逐步棋谱后再判分,属于 P1 范畴,这里先不做。
create or replace function submit_skill_test_result(
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
begin
  if me is null then raise exception '未登录'; end if;

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

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function submit_skill_test_result(jsonb, text, int, text, jsonb) to authenticated;

-- "改天吧 / 中途放弃"这个跳过动作,不涉及任何分数字段,风险很低,但同样
-- 收进 RPC 里,免得又开一个能碰 skill_test_status 的 update 口子。
create or replace function skip_skill_test()
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception '未登录'; end if;
  update profiles set skill_test_status = 'skipped' where id = me;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function skip_skill_test() to authenticated;
