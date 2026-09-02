-- ============================================================
-- 象棋改造 · 第二阶段:服务端权威的中国象棋规则引擎 + 在线对战
--
-- 运行顺序:先跑完 schema.sql、security_hardening_p0.sql、
-- lock_down_finish_match_internal.sql(如果之前已经跑过),再跑这份文件。
-- 这份文件只替换 start_match / make_move 这两个跟"棋盘规则"强相关的
-- 函数,rooms / matchmaking_queue / friendships / match_history 等表结构、
-- 以及 _finish_match_internal(结算经验值)完全不用动——那些都是跟
-- 具体棋种无关的通用对战基础设施,象棋和五子棋可以直接共用。
--
-- 棋盘表示:board 列复用同一个 jsonb 数组列,但从"15x15、0/1/2"改成
-- "9x10(90格)、有符号整数"——正数=红方,负数=黑方,绝对值代表棋子种类
-- (1帅 2仕 3相 4马 5车 6炮 7兵),跟前端 src/game/xiangqiLogic.js 的编码
-- 完全一致,数组下标统一用 y*9+x。player1 固定执红(先手),player2 执黑,
-- 跟 mySlot 1/2 的既有含义保持一致,不需要改前端"slot"这个概念本身。
--
-- 出于服务端权威校验的需要(不能只信任客户端说"这步合法"),这里把
-- src/game/xiangqiLogic.js 里的走法规则、将军判定、绝杀/困毙判定完整地
-- 在 PL/pgSQL 里重新实现了一遍,两边逻辑必须保持同步——以后如果调整了
-- JS 那边的规则,记得回来同步改这个文件。
--
-- 已知局限(留给后续阶段):没有实现"长将/长捉不变作负"和"60回合无
-- 吃子判和"这两条中国象棋的规则性和棋条款,目前只有"困毙/绝杀"两种
-- 结束方式,跟第一阶段本地引擎(xiangqiLogic.js)的行为保持一致。
-- ============================================================

-- ------------------------------------------------------------
-- 基础工具函数
-- ------------------------------------------------------------

create or replace function xq_get(p_board jsonb, p_x int, p_y int)
returns int language sql immutable as $$
  select (p_board->>(p_y * 9 + p_x))::int;
$$;

create or replace function xq_set(p_board jsonb, p_x int, p_y int, p_v int)
returns jsonb language sql immutable as $$
  select jsonb_set(p_board, array[(p_y * 9 + p_x)::text], to_jsonb(p_v));
$$;

create or replace function xq_color(p int)
returns int language sql immutable as $$
  select case when p = 0 then 0 when p > 0 then 1 else -1 end;
$$;

create or replace function xq_in_palace(p_x int, p_y int, p_color int)
returns boolean language sql immutable as $$
  select p_x between 3 and 5 and (
    case when p_color = 1 then p_y between 7 and 9 else p_y between 0 and 2 end
  );
$$;

-- 某一步"伪合法"走法:只看这个棋子本身的走法规则(蹩马腿/塞象眼/过河/
-- 炮架都算在内),不检查走完之后自己会不会被将军——那一层留给
-- xq_is_legal_move 做,这个函数同时也是 xq_is_in_check "判断某格是否被
-- 攻击到" 的复用基础。
create or replace function xq_pseudo_legal(p_board jsonb, p_fx int, p_fy int, p_tx int, p_ty int)
returns boolean language plpgsql immutable as $$
declare
  p int; color int; ptype int; target int;
  dx int; dy int; adx int; ady int;
  ex int; ey int; -- 象眼/马腿
  step int; nx int; ny int; blockers int;
  forward int; crossed boolean;
begin
  if p_tx < 0 or p_tx > 8 or p_ty < 0 or p_ty > 9 then return false; end if;
  p := xq_get(p_board, p_fx, p_fy);
  if p = 0 then return false; end if;
  color := xq_color(p);
  ptype := abs(p);
  target := xq_get(p_board, p_tx, p_ty);
  if target <> 0 and xq_color(target) = color then return false; end if;

  dx := p_tx - p_fx; dy := p_ty - p_fy;
  adx := abs(dx); ady := abs(dy);

  if ptype = 1 then -- 帅/将:九宫内一步直线
    return (adx + ady = 1) and xq_in_palace(p_tx, p_ty, color);

  elsif ptype = 2 then -- 仕/士:九宫内一步斜线
    return (adx = 1 and ady = 1) and xq_in_palace(p_tx, p_ty, color);

  elsif ptype = 3 then -- 相/象:田字,不能过河,不能塞象眼
    if adx <> 2 or ady <> 2 then return false; end if;
    if color = 1 and p_ty < 5 then return false; end if;
    if color = -1 and p_ty > 4 then return false; end if;
    ex := p_fx + dx / 2; ey := p_fy + dy / 2;
    return xq_get(p_board, ex, ey) = 0;

  elsif ptype = 4 then -- 马:日字,不能蹩马腿
    if not ((adx = 1 and ady = 2) or (adx = 2 and ady = 1)) then return false; end if;
    if adx = 2 then ex := p_fx + dx / 2; ey := p_fy; else ex := p_fx; ey := p_fy + dy / 2; end if;
    return xq_get(p_board, ex, ey) = 0;

  elsif ptype = 5 then -- 车:直线,中间不能有子
    if dx <> 0 and dy <> 0 then return false; end if;
    if dx = 0 and dy = 0 then return false; end if;
    if dx <> 0 then
      step := case when dx > 0 then 1 else -1 end;
      nx := p_fx + step;
      while nx <> p_tx loop
        if xq_get(p_board, nx, p_fy) <> 0 then return false; end if;
        nx := nx + step;
      end loop;
    else
      step := case when dy > 0 then 1 else -1 end;
      ny := p_fy + step;
      while ny <> p_ty loop
        if xq_get(p_board, p_fx, ny) <> 0 then return false; end if;
        ny := ny + step;
      end loop;
    end if;
    return true;

  elsif ptype = 6 then -- 炮:直线,不吃子时中间不能有子;吃子时中间必须恰好一个炮架
    if dx <> 0 and dy <> 0 then return false; end if;
    if dx = 0 and dy = 0 then return false; end if;
    blockers := 0;
    if dx <> 0 then
      step := case when dx > 0 then 1 else -1 end;
      nx := p_fx + step;
      while nx <> p_tx loop
        if xq_get(p_board, nx, p_fy) <> 0 then blockers := blockers + 1; end if;
        nx := nx + step;
      end loop;
    else
      step := case when dy > 0 then 1 else -1 end;
      ny := p_fy + step;
      while ny <> p_ty loop
        if xq_get(p_board, p_fx, ny) <> 0 then blockers := blockers + 1; end if;
        ny := ny + step;
      end loop;
    end if;
    if target = 0 then return blockers = 0; else return blockers = 1; end if;

  elsif ptype = 7 then -- 兵/卒:未过河只能直走一步;过河后可以左右横走一步
    forward := case when color = 1 then -1 else 1 end;
    crossed := case when color = 1 then p_fy <= 4 else p_fy >= 5 end;
    if dy = forward and dx = 0 then return true; end if;
    if crossed and dy = 0 and adx = 1 then return true; end if;
    return false;
  end if;

  return false;
end;
$$;

create or replace function xq_find_general(p_board jsonb, p_color int)
returns int[] language plpgsql immutable as $$
declare x int; y int; begin
  for y in 0..9 loop
    for x in 0..8 loop
      if xq_get(p_board, x, y) = p_color * 1 then return array[x, y]; end if;
    end loop;
  end loop;
  return null;
end;
$$;

-- p_color 一方是否正被将军(含"飞将"照面判负规则)
create or replace function xq_is_in_check(p_board jsonb, p_color int)
returns boolean language plpgsql immutable as $$
declare
  gen int[]; gx int; gy int; other int[]; oy int; y int; blocked boolean;
  x int; p int;
begin
  gen := xq_find_general(p_board, p_color);
  if gen is null then return false; end if;
  gx := gen[1]; gy := gen[2];

  other := xq_find_general(p_board, -p_color);
  if other is not null and other[1] = gx then
    blocked := false;
    oy := other[2];
    for y in least(gy, oy) + 1 .. greatest(gy, oy) - 1 loop
      if xq_get(p_board, gx, y) <> 0 then blocked := true; end if;
    end loop;
    if not blocked then return true; end if;
  end if;

  for y in 0..9 loop
    for x in 0..8 loop
      p := xq_get(p_board, x, y);
      if p <> 0 and xq_color(p) = -p_color then
        if xq_pseudo_legal(p_board, x, y, gx, gy) then return true; end if;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- 完整合法性:伪合法 + 走完之后自己不能仍处于被将军状态
create or replace function xq_is_legal_move(p_board jsonb, p_fx int, p_fy int, p_tx int, p_ty int, p_color int)
returns boolean language plpgsql immutable as $$
declare p int; next_board jsonb; begin
  p := xq_get(p_board, p_fx, p_fy);
  if p = 0 or xq_color(p) <> p_color then return false; end if;
  if not xq_pseudo_legal(p_board, p_fx, p_fy, p_tx, p_ty) then return false; end if;
  next_board := xq_set(xq_set(p_board, p_fx, p_fy, 0), p_tx, p_ty, p);
  return not xq_is_in_check(next_board, p_color);
end;
$$;

-- p_color 一方是否还有任何一步合法走法(没有 = 被将死或困毙,规则上都算负)
create or replace function xq_has_any_legal_move(p_board jsonb, p_color int)
returns boolean language plpgsql immutable as $$
declare fx int; fy int; tx int; ty int; p int; begin
  for fy in 0..9 loop
    for fx in 0..8 loop
      p := xq_get(p_board, fx, fy);
      if p <> 0 and xq_color(p) = p_color then
        for ty in 0..9 loop
          for tx in 0..8 loop
            if xq_is_legal_move(p_board, fx, fy, tx, ty, p_color) then
              return true;
            end if;
          end loop;
        end loop;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- 初始摆位:用二维数组按行搭,再压平成 90 长度、下标 y*9+x 的 jsonb 数组,
-- 跟 src/game/xiangqiLogic.js 的 createInitialBoard 逐行对应,不用手算
-- 扁平下标,避免手滑摆错位置。
create or replace function xq_initial_board()
returns jsonb language plpgsql immutable as $$
declare
  back int[] := array[5,4,3,2,1,2,3,4,5]; -- 车马相仕帅仕相马车
  cell int[][] := array_fill(0, array[10,9]); -- [y][x]
  x int; arr jsonb := '[]'::jsonb;
  y int;
begin
  for x in 1..9 loop
    cell[1][x] := -back[x];   -- y=0 黑方底线 (pg数组下标从1开始,这里 cell[1]对应y=0)
    cell[10][x] := back[x];   -- y=9 红方底线
  end loop;
  cell[3][2] := -6; cell[3][8] := -6; -- y=2 黑炮 x=1,7 (pg下标+1)
  cell[8][2] := 6;  cell[8][8] := 6;  -- y=7 红炮
  cell[4][1] := -7; cell[4][3] := -7; cell[4][5] := -7; cell[4][7] := -7; cell[4][9] := -7; -- y=3 黑兵
  cell[7][1] := 7;  cell[7][3] := 7;  cell[7][5] := 7;  cell[7][7] := 7;  cell[7][9] := 7;   -- y=6 红兵

  for y in 1..10 loop
    for x in 1..9 loop
      arr := arr || to_jsonb(cell[y][x]);
    end loop;
  end loop;
  return arr;
end;
$$;

grant execute on function xq_get(jsonb, int, int) to authenticated;
grant execute on function xq_set(jsonb, int, int, int) to authenticated;
grant execute on function xq_color(int) to authenticated;
grant execute on function xq_in_palace(int, int, int) to authenticated;
grant execute on function xq_pseudo_legal(jsonb, int, int, int, int) to authenticated;
grant execute on function xq_find_general(jsonb, int) to authenticated;
grant execute on function xq_is_in_check(jsonb, int) to authenticated;
grant execute on function xq_is_legal_move(jsonb, int, int, int, int, int) to authenticated;
grant execute on function xq_has_any_legal_move(jsonb, int) to authenticated;
grant execute on function xq_initial_board() to authenticated;

-- 局面 key,算法必须跟前端 src/game/xiangqiLogic.js 的 positionKey() 逐字
-- 保持一致(90 个格子拼逗号分隔字符串,再拼上轮走方),两边算出来的 key
-- 才能被认成"同一个局面"——服务器判重复局面只看 key 相不相等,不做
-- 语义上的棋盘比较。
create or replace function xq_board_key(p_board jsonb, p_color int)
returns text language sql immutable as $$
  select (select string_agg(v::text, ',') from jsonb_array_elements_text(p_board) v) || '|' || p_color::text;
$$;
grant execute on function xq_board_key(jsonb, int) to authenticated;

-- 判和棋要用的两列:no_capture_halfmoves 是"最近一次吃子之后已经走了
-- 多少半步",position_history 是"局面+轮走方"字符串数组,判三次重复用。
-- 这两列对五子棋房间没有意义,不填就用默认值,不影响那边的逻辑。
alter table rooms add column if not exists no_capture_halfmoves int not null default 0;
alter table rooms add column if not exists position_history jsonb not null default '[]'::jsonb;
-- 悔棋要能把这两列也恢复回"上一步之前"的状态,不然 board 回退了,
-- position_history 里那一步的 key 还留着没撤,会污染后面的重复局面判断。
-- 跟 board_before_last_move 是同一套思路,只不过多存两份快照。
alter table rooms add column if not exists no_capture_before_last_move int;
alter table rooms add column if not exists position_history_before_last_move jsonb;

-- ------------------------------------------------------------
-- start_match:开局摆好 90 格的初始棋盘,红方(player1)先手
-- ------------------------------------------------------------
create or replace function start_match(p_room_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
begin
  if me is null then raise exception '未登录'; end if;
  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then return jsonb_build_object('error', '无权限'); end if;
  if r.status <> 'lobby' then return jsonb_build_object('error', '当前状态不能开始对局'); end if;

  update rooms set
    status = 'playing',
    board = xq_initial_board(),
    current_turn = 1, -- 红方(player1)先手
    move_count = 0,
    winner = null,
    no_capture_halfmoves = 0,
    position_history = '[]'::jsonb,
    turn_deadline = now() + interval '60 seconds', -- 象棋每步信息量更大,给的思考时间比五子棋(30秒)长一些
    player1_last_seen = now(),
    player2_last_seen = now(),
    started_at = now()
  where id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function start_match(uuid) to authenticated;

-- ------------------------------------------------------------
-- make_move:落子改成"从A格走到B格",服务端完整校验走法合法性
-- (不再只检查"目标格是否为空"),并在同一次事务里判定绝杀/困毙。
-- 签名从 (room_id, x, y, session_id) 改成 (room_id, fx, fy, tx, ty, session_id)。
-- ------------------------------------------------------------
create or replace function make_move(p_room_id uuid, p_fx int, p_fy int, p_tx int, p_ty int, p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
  my_slot int;
  my_color int;
  v_board jsonb;
  moved_piece int;
  new_move_count int;
  settlement jsonb;
  opp_color int;
  opp_in_check boolean;
  opp_has_move boolean;
  v_captured boolean;
  v_no_capture int;
  v_position_key text;
  v_position_history jsonb;
  v_repeat_count int;
begin
  if me is null then raise exception '未登录'; end if;
  perform _validate_session(p_session_id);

  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then return jsonb_build_object('error', '无权限'); end if;
  if r.status <> 'playing' then return jsonb_build_object('error', '对局不在进行中'); end if;
  if r.undo_requested_by is not null then return jsonb_build_object('error', '有悔棋请求待处理'); end if;

  my_slot := case when me = r.player1_id then 1 else 2 end;
  my_color := case when my_slot = 1 then 1 else -1 end; -- 1=红 -1=黑
  if r.current_turn <> my_slot then return jsonb_build_object('error', '还没轮到你'); end if;
  if p_fx < 0 or p_fx > 8 or p_fy < 0 or p_fy > 9 or p_tx < 0 or p_tx > 8 or p_ty < 0 or p_ty > 9 then
    return jsonb_build_object('error', '坐标越界');
  end if;

  v_board := r.board;
  if not xq_is_legal_move(v_board, p_fx, p_fy, p_tx, p_ty, my_color) then
    return jsonb_build_object('error', '不是合法的走法');
  end if;

  moved_piece := xq_get(v_board, p_fx, p_fy);
  v_captured := xq_get(v_board, p_tx, p_ty) <> 0;
  v_board := xq_set(xq_set(v_board, p_fx, p_fy, 0), p_tx, p_ty, moved_piece);
  new_move_count := r.move_count + 1;
  opp_color := -my_color;

  -- 和棋判定用的两个累积量:无吃子半步数(吃子就清零),以及"局面+轮走方"
  -- 的历史(用来判三次重复)。position_history 存的是 xq_board_key() 算出
  -- 来的字符串数组,数组本身不会无限增长太夸张——一整盘棋撑死几百步,
  -- 每个 key 几十字符,jsonb 里放这个量级完全没有性能问题。
  v_no_capture := case when v_captured then 0 else coalesce(r.no_capture_halfmoves, 0) + 1 end;
  v_position_key := xq_board_key(v_board, opp_color);
  v_position_history := coalesce(r.position_history, '[]'::jsonb) || to_jsonb(v_position_key);
  select count(*) into v_repeat_count from jsonb_array_elements_text(v_position_history) k where k = v_position_key;

  update rooms set
    board = v_board,
    current_turn = case when my_slot = 1 then 2 else 1 end,
    move_count = new_move_count,
    board_before_last_move = r.board,
    no_capture_before_last_move = coalesce(r.no_capture_halfmoves, 0),
    position_history_before_last_move = coalesce(r.position_history, '[]'::jsonb),
    undo_requested_by = null,
    turn_deadline = now() + interval '60 seconds',
    no_capture_halfmoves = v_no_capture,
    position_history = v_position_history,
    player1_last_seen = case when my_slot = 1 then now() else player1_last_seen end,
    player2_last_seen = case when my_slot = 2 then now() else player2_last_seen end
  where id = p_room_id;

  -- 走完这步之后,轮到对方——如果对方一步合法走法都没有,直接结束
  -- (不管是被将死还是困毙,中国象棋规则下都算这一方负,不区分"和棋")
  opp_has_move := xq_has_any_legal_move(v_board, opp_color);
  if not opp_has_move then
    opp_in_check := xq_is_in_check(v_board, opp_color);
    settlement := _finish_match_internal(p_room_id, my_slot, 'normal');
    return jsonb_build_object(
      'ok', true, 'move_count', new_move_count,
      'game_status', 'finished', 'winner', my_slot,
      'end_kind', case when opp_in_check then 'checkmate' else 'stalemate' end,
      'settlement', settlement
    );
  end if;

  -- 60 回合(120 半步)无吃子,或者同一局面(含轮走方)出现 3 次,直接判和——
  -- 这两条比"长将/长捉不变作负"简单得多,不需要判断谁在主动重复,纯粹按
  -- 局面/步数计数,规则边界清楚,不会有争议判罚。
  if v_no_capture >= 120 or v_repeat_count >= 3 then
    settlement := _finish_match_internal(p_room_id, 0, 'normal');
    return jsonb_build_object(
      'ok', true, 'move_count', new_move_count,
      'game_status', 'finished', 'winner', 0,
      'end_kind', case when v_repeat_count >= 3 then 'repetition' else 'sixty_move' end,
      'settlement', settlement
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'move_count', new_move_count, 'game_status', 'playing',
    'in_check', xq_is_in_check(v_board, opp_color)
  );
end;
$$;

grant execute on function make_move(uuid, int, int, int, int, uuid) to authenticated;

-- finish_match(认输/掉线判负)不涉及棋盘规则,原有实现(security_hardening_p0.sql
-- 里那份,只接受 forfeit/disconnect,拒绝 normal)不需要跟着改,继续沿用。

-- ============================================================
-- 补完阶段二遗漏的几个点(2025 补充):
--
-- 1) schema.sql 里除了 start_match/make_move,还有三个入口会自己直接拼
--    一份"空棋盘"把房间状态怼到 playing/lobby,完全绕开了 start_match:
--    match_players(快速匹配)、create_rematch(再来一局另开新房)、
--    return_to_room(双方都点了"再来一局"后重置同一间房)。这三个之前
--    还留着 `jsonb_agg(0) from generate_series(1,225)`(五子棋 15x15 的
--    全零空棋盘)——对五子棋来说"空棋盘"就是正确的开局,但象棋开局是
--    要摆好 32 个子的,不能是空的,所以这三个函数必须换成 xq_initial_board()。
--    同时把回合时限从五子棋的 30 秒统一成跟 start_match/make_move 一致的
--    60 秒,不然"快速匹配"跟"大厅里点开始"两种途径开出来的对局,第一步
--    的思考时间会不一样长。
--
-- 2) security_hardening_p0.sql 里的 make_move(uuid,int,int,uuid) 是四个
--    参数的五子棋签名,这次改成 make_move(uuid,int,int,int,int,uuid) 六个
--    参数的象棋签名——在 Postgres 里参数列表不同的函数是两个不同的重载,
--    `create or replace` 并不会把旧的四参数版本顶掉,而是让它继续留在
--    数据库里没人用但也没人删。为避免以后误调到那个按 15x15 棋盘算胜负
--    的旧版本,这里显式把它和它专属的 check_five_in_a_row 一起删掉。
--
-- 3) respond_undo 悔棋成功后重新计时那一下,也统一从 30 秒改成 60 秒。
-- ============================================================

drop function if exists make_move(uuid, int, int, uuid);
drop function if exists check_five_in_a_row(jsonb, int, int, int);

create or replace function match_players(me uuid, my_exp int default 0)
returns uuid
language plpgsql
security definer
as $$
declare
  opponent record;
  new_room_id uuid;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;

  delete from matchmaking_queue where player_id = me;
  delete from matchmaking_queue where created_at < now() - interval '2 minutes';

  select * into opponent
  from matchmaking_queue
  where player_id <> me and created_at >= now() - interval '2 minutes'
  order by created_at asc
  for update skip locked
  limit 1;

  if opponent.player_id is not null then
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn, turn_deadline, player1_last_seen, player2_last_seen)
    values ('matchmaking', 'playing', opponent.player_id, me,
      xq_initial_board(), 1,
      now() + interval '60 seconds', now(), now())
    returning id into new_room_id;

    delete from matchmaking_queue where player_id = opponent.player_id;
    return new_room_id;
  else
    insert into matchmaking_queue (player_id, exp) values (me, my_exp);
    return null;
  end if;
end;
$$;

create or replace function create_rematch(p_old_room_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  old_room rooms%rowtype;
  new_id uuid;
  existing_id uuid;
begin
  if auth.uid() is null then
    raise exception '未登录';
  end if;

  select * into old_room from rooms where id = p_old_room_id;
  if old_room.id is null then
    return null;
  end if;
  if auth.uid() <> old_room.player1_id and auth.uid() <> old_room.player2_id then
    return null;
  end if;
  if old_room.status <> 'finished' then
    return null;
  end if;

  select id into existing_id from rooms where rematch_of = p_old_room_id;
  if existing_id is not null then
    return existing_id;
  end if;

  begin
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn, rematch_of, turn_deadline, player1_last_seen, player2_last_seen)
    values (old_room.mode, 'playing', old_room.player2_id, old_room.player1_id,
      xq_initial_board(), 1, p_old_room_id,
      now() + interval '60 seconds', now(), now())
    returning id into new_id;
    return new_id;
  exception when unique_violation then
    select id into existing_id from rooms where rematch_of = p_old_room_id;
    return existing_id;
  end;
end;
$$;

create or replace function return_to_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
begin
  if me is null then raise exception '未登录'; end if;

  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then return jsonb_build_object('error', '无权限'); end if;
  if r.status <> 'finished' then return jsonb_build_object('error', '对局尚未结束'); end if;

  if me = r.player1_id then
    update rooms set player1_rematch_ready = true where id = p_room_id;
  else
    update rooms set player2_rematch_ready = true where id = p_room_id;
  end if;

  select * into r from rooms where id = p_room_id;

  if r.player1_rematch_ready and r.player2_rematch_ready then
    update rooms set
      status = 'lobby', board = xq_initial_board(), current_turn = 1, winner = null,
      end_reason = 'normal', move_count = 0,
      undo_requested_by = null, board_before_last_move = null,
      no_capture_halfmoves = 0, position_history = '[]'::jsonb,
      player1_rematch_ready = false, player2_rematch_ready = false
    where id = p_room_id;
    return jsonb_build_object('status', 'restarted');
  end if;

  return jsonb_build_object('status', 'waiting_for_opponent');
end;
$$;

create or replace function respond_undo(p_room_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
begin
  if me is null then raise exception '未登录'; end if;

  select * into r from rooms where id = p_room_id for update;
  if r.id is null then return jsonb_build_object('error', '房间不存在'); end if;
  if me <> r.player1_id and me <> r.player2_id then return jsonb_build_object('error', '无权限'); end if;
  if r.undo_requested_by is null then return jsonb_build_object('error', '没有待处理的悔棋请求'); end if;
  if me = r.undo_requested_by then return jsonb_build_object('error', '不能回应自己发起的请求'); end if;

  if p_accept then
    update rooms set
      board = r.board_before_last_move,
      current_turn = case when current_turn = 1 then 2 else 1 end,
      move_count = greatest(move_count - 1, 0),
      board_before_last_move = null,
      no_capture_halfmoves = coalesce(r.no_capture_before_last_move, 0),
      position_history = coalesce(r.position_history_before_last_move, '[]'::jsonb),
      no_capture_before_last_move = null,
      position_history_before_last_move = null,
      undo_requested_by = null,
      turn_deadline = now() + interval '60 seconds'
    where id = p_room_id;
    return jsonb_build_object('accepted', true);
  else
    update rooms set undo_requested_by = null where id = p_room_id;
    return jsonb_build_object('accepted', false);
  end if;
end;
$$;

grant execute on function match_players(uuid, int) to authenticated;
grant execute on function create_rematch(uuid) to authenticated;
grant execute on function return_to_room(uuid) to authenticated;
grant execute on function respond_undo(uuid, boolean) to authenticated;
