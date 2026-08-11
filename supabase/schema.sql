-- ============================================================
-- 墨局五子棋 · 数据库结构
-- 在 Supabase 控制台 SQL Editor 里整段运行一次即可
-- ============================================================

-- 玩家资料表:一个 auth.users 对应一行
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_id bigint unique,
  username text,
  display_name text,
  avatar_url text,
  rating int not null default 1200,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  is_guest boolean not null default false, -- 浏览器调试用的匿名账号,不是真实Telegram用户
  nickname_confirmed boolean not null default false, -- 首次进入时是否已经过"确认昵称"这一步;
                                                       -- 没确认之前 display_name 只是从 Telegram 自动带过来的默认值
  created_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目
alter table profiles add column if not exists is_guest boolean not null default false;
alter table profiles add column if not exists nickname_confirmed boolean not null default false;

-- 网页版用户名密码账号:username 唯一性本来就已经靠 auth.users.email 的
-- 唯一约束间接保证了(注册时用用户名拼邮箱),这里加一道不区分大小写的
-- 唯一索引纯粹是双保险 + 方便以后按用户名查询。
--
-- 注意条件里专门加了 telegram_id is null——这一列 Telegram 用户也会用
-- (存的是 Telegram 的 @handle),如果不排除掉,网页注册用户万一跟某个
-- Telegram 用户的 @handle 撞名,会导致 telegram-auth 那边 upsert profiles
-- 时触发唯一约束冲突而登录失败,网页版这边的改动就反过来把 Telegram
-- 登录搞坏了。加上这个条件,这道索引只管网页账号自己的命名空间。
create unique index if not exists profiles_username_unique
  on profiles (lower(username))
  where username is not null and telegram_id is null;

-- 对局房间表
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique,                          -- 邀请码,匹配对局可为空
  mode text not null check (mode in ('invite', 'matchmaking')),
  status text not null default 'waiting' check (status in ('waiting', 'lobby', 'playing', 'finished')),
  player1_id uuid references profiles(id),
  player2_id uuid references profiles(id),
  board jsonb not null default '[]'::jsonb,  -- 15x15 数组,0=空 1=黑 2=白
  current_turn int not null default 1,        -- 1 或 2,对应 player1 / player2
  winner int,                                 -- 1, 2, 0(平局), null(进行中)
  end_reason text default 'normal',           -- normal(五连/平局) | forfeit(主动认输) | disconnect(掉线超时判负)
  move_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目:老的 check 约束里没有 'lobby' 这个值,得先删旧的再建新的
do $$
begin
  alter table rooms drop constraint if exists rooms_status_check;
  alter table rooms add constraint rooms_status_check
    check (status in ('waiting', 'lobby', 'playing', 'finished'));
exception when others then
  null;
end $$;

-- 匹配队列表
create table if not exists matchmaking_queue (
  id uuid primary key default gen_random_uuid(),
  player_id uuid unique references profiles(id) on delete cascade,
  rating int not null default 1200,
  created_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目:补上 end_reason 字段
alter table rooms add column if not exists end_reason text default 'normal';

-- 悔棋:undo_requested_by 记录当前是谁发起的悔棋请求(null=没有待处理的请求);
-- board_before_last_move 是"最近一步落子之前"的棋盘快照,只保留一步,同意悔棋
-- 就直接回退到这个快照——不做多步撤销历史栈,保持简单。
alter table rooms add column if not exists undo_requested_by uuid references profiles(id);
alter table rooms add column if not exists board_before_last_move jsonb;

-- "返回房间"重开:结算之后,双方各自点"返回房间"会各自置位;两个都置位了
-- 才把房间重置回 lobby 状态,复用原来"大厅"那套等待开始对局的界面,不用
-- 另外再建一套"重开确认"的流程。
alter table rooms add column if not exists player1_rematch_ready boolean not null default false;
alter table rooms add column if not exists player2_rematch_ready boolean not null default false;

-- updated_at 自动刷新
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rooms_updated on rooms;
create trigger trg_rooms_updated before update on rooms
for each row execute function set_updated_at();

-- ============================================================
-- 行级安全策略(RLS)
-- ============================================================
alter table profiles enable row level security;
alter table rooms enable row level security;
alter table matchmaking_queue enable row level security;

-- profiles:本人可读写自己那一行,其他人只读(用于显示对手信息)
drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select using (true);

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles for update using (auth.uid() = id);

drop policy if exists "profiles_insert_self" on profiles;
create policy "profiles_insert_self" on profiles for insert with check (auth.uid() = id);

-- rooms:参与者或邀请码持有者可读;创建者可插入;参与者可更新
drop policy if exists "rooms_select" on rooms;
create policy "rooms_select" on rooms for select using (
  auth.uid() = player1_id or auth.uid() = player2_id or status = 'waiting'
);

drop policy if exists "rooms_insert" on rooms;
create policy "rooms_insert" on rooms for insert with check (auth.uid() = player1_id);

drop policy if exists "rooms_update" on rooms;
create policy "rooms_update" on rooms for update using (
  auth.uid() = player1_id or auth.uid() = player2_id
);

-- matchmaking_queue:本人可插入/删除自己的排队记录
drop policy if exists "queue_select" on matchmaking_queue;
create policy "queue_select" on matchmaking_queue for select using (true);

drop policy if exists "queue_insert" on matchmaking_queue;
create policy "queue_insert" on matchmaking_queue for insert with check (auth.uid() = player_id);

drop policy if exists "queue_delete" on matchmaking_queue;
create policy "queue_delete" on matchmaking_queue for delete using (auth.uid() = player_id);

-- ============================================================
-- 原子匹配函数:把队列里等待时间最长、且不是自己的一个人拉出来配对
-- 用 FOR UPDATE SKIP LOCKED 避免两个客户端同时抢到同一个对手
-- ============================================================
create or replace function match_players(me uuid, my_rating int default 1200)
returns uuid
language plpgsql
security definer
as $$
declare
  opponent record;
  new_room_id uuid;
begin
  -- 安全修复:不信任客户端传来的 me,强制用数据库自己验证过的当前登录身份覆盖它,
  -- 否则任何人传别人的 uuid 进来就能代替别人排队/触发匹配
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;

  -- 先把自己已有的排队记录清掉,避免重复排队
  delete from matchmaking_queue where player_id = me;

  -- 顺手清掉超过2分钟没成交的"幽灵"排队记录(对方可能已经关闭小程序、断网等)
  delete from matchmaking_queue where created_at < now() - interval '2 minutes';

  -- 尝试锁一个等待中的对手(排除自己,且必须是2分钟内的有效记录)
  select * into opponent
  from matchmaking_queue
  where player_id <> me and created_at >= now() - interval '2 minutes'
  order by created_at asc
  for update skip locked
  limit 1;

  if opponent.player_id is not null then
    -- 找到对手,直接建房间,双方各占一个 player 位
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn)
    values ('matchmaking', 'playing', opponent.player_id, me, '[]'::jsonb, 1)
    returning id into new_room_id;

    delete from matchmaking_queue where player_id = opponent.player_id;
    return new_room_id;
  else
    -- 没找到,自己进队列等待,返回 null 表示"请等待"
    insert into matchmaking_queue (player_id, rating) values (me, my_rating);
    return null;
  end if;
end;
$$;

-- ============================================================
-- 加入邀请房间:原子更新,避免两个人同时抢同一个房间号
-- ============================================================
create or replace function join_room(room_code text, me uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  target_id uuid;
begin
  -- 安全修复:同上,不信任客户端传的 me
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;

  update rooms
  set player2_id = me, status = 'lobby'
  where code = room_code and player2_id is null and player1_id <> me
  returning id into target_id;

  return target_id; -- null 表示房间不存在/已满/房主是自己
end;
$$;

-- 把 rooms 加入 Realtime 发布,前端才能订阅到落子更新
alter publication supabase_realtime add table rooms;

-- ============================================================
-- 退出房间(仅限对局开始前,status 还是 waiting/lobby 的时候):
-- - 我是对手(player2)退出:房主还在,房间保留,对手位清空、状态退回 waiting
-- - 我是房主(player1)退出,但对手已经在房里:房主之位自动转给对手,
--   房间保留、状态退回 waiting(对手那边靠已有的 rooms UPDATE 订阅就能
--   实时收到自己被扶正,不用另外建通知表)
-- - 我是房主退出,房里就我自己(对手位是空的):房间没有存在意义了,直接删,
--   不用等 30 分钟跑一次的 cleanup_stale_rooms 兜底
-- 对局已经开始(status='playing')不允许走这条路径退出——那属于中途认输,
-- 走的是另一套 finish_game / end_reason='forfeit' 逻辑。
-- 用 security definer + for update 行锁保证原子性,避免两个人同时点退出
-- 时互相踩踏(比如对手退出的同时房主也点了退出)。
-- ============================================================
create or replace function leave_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
begin
  if me is null then
    raise exception '未登录';
  end if;

  select * into r from rooms where id = p_room_id for update;
  if not found then
    -- 房间已经不在了(可能已经被清理或对方也刚好退出触发了删除),
    -- 前端直接当作"退出成功"处理就好,不用报错打断用户
    return jsonb_build_object('action', 'not_found');
  end if;

  if r.status not in ('waiting', 'lobby') then
    raise exception '对局已经开始,不能用这个接口退出房间';
  end if;

  if me = r.player1_id then
    if r.player2_id is not null then
      update rooms
      set player1_id = r.player2_id, player2_id = null,
          status = 'waiting', updated_at = now()
      where id = p_room_id;
      return jsonb_build_object('action', 'transferred', 'new_host', r.player2_id);
    else
      delete from game_invites where room_id = p_room_id;
      delete from rooms where id = p_room_id;
      return jsonb_build_object('action', 'deleted');
    end if;
  elsif me = r.player2_id then
    update rooms
    set player2_id = null, status = 'waiting', updated_at = now()
    where id = p_room_id;
    return jsonb_build_object('action', 'left');
  else
    raise exception '你不是这个房间的参与者';
  end if;
end;
$$;

grant execute on function leave_room(uuid) to authenticated;

-- ============================================================
-- 再来一局:用唯一索引在数据库层面杜绝竞态——如果双方同时点"再来一局",
-- 只会有一间新房间真正建成,另一次尝试会撞上唯一约束,查回已建好的那间即可,
-- 不会出现"各自建了一间、互相进错房间干等"的情况
-- ============================================================
alter table rooms add column if not exists rematch_of uuid references rooms(id);

create unique index if not exists idx_rooms_rematch_of on rooms(rematch_of) where rematch_of is not null;

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
    return null; -- 不是这局的参与者,不许建
  end if;
  if old_room.status <> 'finished' then
    return null; -- 防御性检查:不依赖前端"只在对局结束后才会调用这个接口"这个假设,
                 -- 数据库层自己也要确认这局真的结束了,不能对着一局还在进行中的对局
                 -- 凭空建一间新房间出来
  end if;

  -- 已经有人先手点过"再来一局"了,直接把那间返回,不重复建
  select id into existing_id from rooms where rematch_of = p_old_room_id;
  if existing_id is not null then
    return existing_id;
  end if;

  begin
    -- 双方轮流当先手,公平一点:这局谁是 player2 谁在下一局先走
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn, rematch_of)
    values (old_room.mode, 'playing', old_room.player2_id, old_room.player1_id, '[]'::jsonb, 1, p_old_room_id)
    returning id into new_id;
    return new_id;
  exception when unique_violation then
    -- 极小概率:两人几乎同时点,撞上了唯一索引,查回刚才那次插入成功的那间就行
    select id into existing_id from rooms where rematch_of = p_old_room_id;
    return existing_id;
  end;
end;
$$;

-- ============================================================
-- 好友码:每个玩家一个永久的 6 位邀请码,只在建号时生成一次
-- ============================================================
alter table profiles add column if not exists friend_code text unique;

create or replace function gen_friend_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  taken boolean;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from profiles where friend_code = code) into taken;
    exit when not taken;
  end loop;
  return code;
end;
$$;

create or replace function set_friend_code()
returns trigger as $$
begin
  if new.friend_code is null then
    new.friend_code := gen_friend_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_friend_code on profiles;
create trigger trg_profiles_friend_code before insert on profiles
for each row execute function set_friend_code();

-- ============================================================
-- 好友关系(存成互相的两行,方便直接按 user_id 查询"我的好友列表")
-- ============================================================
create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  friend_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, friend_id)
);

alter table friendships enable row level security;

drop policy if exists "friendships_select" on friendships;
create policy "friendships_select" on friendships for select using (auth.uid() = user_id);

drop policy if exists "friendships_delete" on friendships;
create policy "friendships_delete" on friendships for delete using (auth.uid() = user_id);

-- 已弃用:"好友码"这套加好友方式已经从产品设计里去掉了,改成下面的
-- "搜索昵称 + 发送申请 + 对方同意"模式。这个函数和上面 friend_code 相关的
-- 字段/触发器不再被前端调用,原样留着只是为了不破坏已经部署过的老数据库
-- 结构(万一还有历史数据/深链接依赖它),新项目可以忽略、不必特地删掉。
create or replace function add_friend_by_code(my_id uuid, target_code text)
returns jsonb
language plpgsql
security definer
as $$
declare
  target record;
begin
  -- 安全修复:同上
  my_id := auth.uid();
  if my_id is null then
    return jsonb_build_object('error', '未登录');
  end if;

  select id, display_name, avatar_url, rating into target
  from profiles where friend_code = upper(target_code);

  if target.id is null then
    return jsonb_build_object('error', '好友码不存在');
  end if;
  if target.id = my_id then
    return jsonb_build_object('error', '不能添加自己');
  end if;

  insert into friendships (user_id, friend_id) values (my_id, target.id) on conflict do nothing;
  insert into friendships (user_id, friend_id) values (target.id, my_id) on conflict do nothing;

  return jsonb_build_object(
    'id', target.id, 'display_name', target.display_name,
    'avatar_url', target.avatar_url, 'rating', target.rating
  );
end;
$$;

-- ============================================================
-- 加好友新方式:搜索用户昵称 → 发送好友申请 → 对方同意 → 双方互为好友。
-- 取代上面的好友码方案。用一张单独的申请表存"谁申请了谁",
-- 通过之后才在 friendships 里各写一行(跟原来好友码那套落地方式一致,
-- 这样好友列表/在线胶囊条等下游查询完全不用改)。
-- ============================================================
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id) on delete cascade,
  to_id uuid references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique(from_id, to_id) -- 同一个人不能对同一个目标同时挂着好几条申请
);

alter table friend_requests enable row level security;

-- 只有申请的发起人或接收人能看到这条申请
drop policy if exists "friend_requests_select" on friend_requests;
create policy "friend_requests_select" on friend_requests for select using (
  auth.uid() = from_id or auth.uid() = to_id
);

alter publication supabase_realtime add table friend_requests;

-- 发送好友申请。如果对方之前已经先申请过我(双方都待处理、谁也没点同意),
-- 这里直接判定为互相同意、当场加好友,不用再走一遍"对方同意"的流程——
-- 不然会出现两个人都点了"申请",却都在傻等对方点同意的死锁体验。
-- 已经是好友、或者申请对象是自己,直接返回错误提示,不让重复写入。
create or replace function send_friend_request(p_to_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  reverse_req record;
begin
  if me is null then
    return jsonb_build_object('error', '未登录');
  end if;
  if p_to_id = me then
    return jsonb_build_object('error', '不能添加自己');
  end if;
  if not exists(select 1 from profiles where id = p_to_id) then
    return jsonb_build_object('error', '用户不存在');
  end if;
  if exists(select 1 from friendships where user_id = me and friend_id = p_to_id) then
    return jsonb_build_object('error', '你们已经是好友了');
  end if;

  select * into reverse_req from friend_requests
  where from_id = p_to_id and to_id = me and status = 'pending';

  if reverse_req.id is not null then
    insert into friendships (user_id, friend_id) values (me, p_to_id) on conflict do nothing;
    insert into friendships (user_id, friend_id) values (p_to_id, me) on conflict do nothing;
    update friend_requests set status = 'accepted' where id = reverse_req.id;
    return jsonb_build_object('status', 'auto_accepted');
  end if;

  insert into friend_requests (from_id, to_id, status)
  values (me, p_to_id, 'pending')
  on conflict (from_id, to_id) do update
    set status = 'pending', created_at = now()
    where friend_requests.status = 'declined'; -- 之前被拒绝过的话,允许重新申请一次

  return jsonb_build_object('status', 'pending');
end;
$$;

grant execute on function send_friend_request(uuid) to authenticated;

-- 回应收到的好友申请:同意就双向写 friendships,拒绝就只是标记状态,
-- 不删除这条记录(留着能防止对方短时间内反复重复申请刷屏)。
create or replace function respond_friend_request(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  req record;
begin
  if me is null then
    return jsonb_build_object('error', '未登录');
  end if;

  select * into req from friend_requests
  where id = p_request_id and to_id = me and status = 'pending';

  if req.id is null then
    return jsonb_build_object('error', '申请不存在或已处理');
  end if;

  if p_accept then
    insert into friendships (user_id, friend_id) values (me, req.from_id) on conflict do nothing;
    insert into friendships (user_id, friend_id) values (req.from_id, me) on conflict do nothing;
    update friend_requests set status = 'accepted' where id = p_request_id;
    return jsonb_build_object('status', 'accepted');
  else
    update friend_requests set status = 'declined' where id = p_request_id;
    return jsonb_build_object('status', 'declined');
  end if;
end;
$$;

grant execute on function respond_friend_request(uuid, boolean) to authenticated;

-- ============================================================
-- 对战邀请通知:好友之间发起邀请,对方下次打开/在线时能看到并一键加入
-- ============================================================
create table if not exists game_invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid references profiles(id),
  to_id uuid references profiles(id),
  room_id uuid references rooms(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  response_message text, -- 收到邀请的一方回应时可以顺手带一句话(不强制),比如"稍等我两分钟"
  created_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目
alter table game_invites add column if not exists response_message text;

alter table game_invites enable row level security;

drop policy if exists "invites_select" on game_invites;
create policy "invites_select" on game_invites for select using (auth.uid() = from_id or auth.uid() = to_id);

drop policy if exists "invites_insert" on game_invites;
create policy "invites_insert" on game_invites for insert with check (auth.uid() = from_id);

drop policy if exists "invites_update" on game_invites;
create policy "invites_update" on game_invites for update using (auth.uid() = to_id);

alter publication supabase_realtime add table game_invites;

-- 接受好友对战邀请:接受的人在这一刻还不是房间的参与者,普通的 rooms_update RLS
-- 策略("必须已经是参与者才能改这行")会直接拒绝这次更新——这是个鸡生蛋问题,
-- 只能靠 security definer 函数来"破冰"
create or replace function accept_game_invite(p_invite_id uuid, p_message text default null)
returns uuid
language plpgsql
security definer
as $$
declare
  inv record;
  target_room rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception '未登录';
  end if;

  select * into inv from game_invites
  where id = p_invite_id and to_id = auth.uid() and status = 'pending';

  if inv.id is null then
    return null; -- 不是发给我的、或者已经被处理过了
  end if;

  select * into target_room from rooms where id = inv.room_id for update;

  if target_room.id is null or target_room.player2_id is not null then
    update game_invites set status = 'declined' where id = p_invite_id;
    return null; -- 房间已失效或者已经被别人占了
  end if;

  update rooms set player2_id = auth.uid(), status = 'lobby' where id = target_room.id;
  update game_invites set status = 'accepted', response_message = p_message where id = p_invite_id;

  return target_room.id;
end;
$$;

-- ============================================================
-- 战绩记录 + 积分(ELO)系统
-- ============================================================
create table if not exists match_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id),
  player1_id uuid references profiles(id),
  player2_id uuid references profiles(id),
  winner int, -- 0=平局 1/2=对应玩家
  end_reason text default 'normal',
  player1_rating_before int,
  player2_rating_before int,
  player1_rating_after int,
  player2_rating_after int,
  created_at timestamptz not null default now()
);

alter table match_history add column if not exists end_reason text default 'normal';

alter table match_history enable row level security;

drop policy if exists "history_select" on match_history;
create policy "history_select" on match_history for select using (
  auth.uid() = player1_id or auth.uid() = player2_id
);

-- 结束一局对战:计算 ELO、更新双方 profiles、写历史、关闭房间
-- 用 security definer 是因为普通玩家的 RLS 权限改不了对方的 rating
-- p_reason: normal(五连/平局) | forfeit(主动认输离开) | disconnect(对方掉线超时,由在线一方判负)
create or replace function finish_match(p_room_id uuid, p_winner int, p_reason text default 'normal')
returns jsonb
language plpgsql
security definer
as $$
declare
  r rooms%rowtype;
  p1 profiles%rowtype;
  p2 profiles%rowtype;
  exp1 float; exp2 float;
  score1 float; score2 float;
  k int := 32;
  new1 int; new2 int;
begin
  select * into r from rooms where id = p_room_id for update;

  if r.id is null then
    return jsonb_build_object('error', '房间不存在');
  end if;

  -- 安全修复:必须是这局对局的参与者才能结算它,否则任何登录用户随便传个 room_id
  -- 和 winner 就能篡改别人的对局结果和积分
  if auth.uid() is null or (auth.uid() <> r.player1_id and auth.uid() <> r.player2_id) then
    return jsonb_build_object('error', '无权限操作该对局');
  end if;

  if r.status = 'finished' then
    return jsonb_build_object('already_finished', true);
  end if;

  select * into p1 from profiles where id = r.player1_id;
  select * into p2 from profiles where id = r.player2_id;

  exp1 := 1.0 / (1 + power(10, (p2.rating - p1.rating) / 400.0));
  exp2 := 1.0 - exp1;

  if p_winner = 1 then score1 := 1; score2 := 0;
  elsif p_winner = 2 then score1 := 0; score2 := 1;
  else score1 := 0.5; score2 := 0.5;
  end if;

  new1 := round(p1.rating + k * (score1 - exp1));
  new2 := round(p2.rating + k * (score2 - exp2));

  update profiles set
    rating = new1,
    wins = wins + (case when p_winner = 1 then 1 else 0 end),
    losses = losses + (case when p_winner = 2 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p1.id;

  update profiles set
    rating = new2,
    wins = wins + (case when p_winner = 2 then 1 else 0 end),
    losses = losses + (case when p_winner = 1 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p2.id;

  update rooms set status = 'finished', winner = p_winner, end_reason = p_reason where id = p_room_id;

  insert into match_history (
    room_id, player1_id, player2_id, winner, end_reason,
    player1_rating_before, player2_rating_before, player1_rating_after, player2_rating_after
  ) values (
    p_room_id, p1.id, p2.id, p_winner, p_reason, p1.rating, p2.rating, new1, new2
  );

  return jsonb_build_object(
    'my1_delta', new1 - p1.rating, 'my2_delta', new2 - p2.rating,
    'p1_new', new1, 'p2_new', new2
  );
end;
$$;

-- ============================================================
-- 悔棋:请求 + 回应两步,不能单方面直接改棋盘——跟落子/判负一样,
-- 这里同样没有去校验 board_before_last_move 是否真的对应"上一步",
-- 客户端写进去什么就是什么,属于跟其余落子逻辑一致的既有信任模型,
-- 不是这里新引入的问题,后续要收紧建议跟落子合法性一起做。
-- ============================================================
create or replace function request_undo(p_room_id uuid)
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
  if r.status <> 'playing' then return jsonb_build_object('error', '对局不在进行中'); end if;
  if r.board_before_last_move is null then return jsonb_build_object('error', '还没有可以悔的棋'); end if;
  if r.undo_requested_by is not null then return jsonb_build_object('error', '已经有一个悔棋请求在等待处理'); end if;

  update rooms set undo_requested_by = me where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function request_undo(uuid) to authenticated;

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
      undo_requested_by = null
    where id = p_room_id;
    return jsonb_build_object('accepted', true);
  else
    update rooms set undo_requested_by = null where id = p_room_id;
    return jsonb_build_object('accepted', false);
  end if;
end;
$$;

grant execute on function respond_undo(uuid, boolean) to authenticated;

-- ============================================================
-- 结算后"返回房间":双方各自调用一次,都调用过了才把房间重置回
-- lobby,复用大厅界面重新开始;只有一方调用,则该方留在"等待对方"
-- 的状态里,可以另外去重新邀请好友或者进匹配(前端处理,不在这里)。
-- ============================================================
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
      status = 'lobby', board = '[]'::jsonb, current_turn = 1, winner = null,
      end_reason = 'normal', move_count = 0,
      undo_requested_by = null, board_before_last_move = null,
      player1_rematch_ready = false, player2_rematch_ready = false
    where id = p_room_id;
    return jsonb_build_object('status', 'restarted');
  end if;

  return jsonb_build_object('status', 'waiting_for_opponent');
end;
$$;

grant execute on function return_to_room(uuid) to authenticated;

-- ============================================================
-- 孤儿房间清理:邀请对局如果创建后一直没人加入(朋友没点、或者
-- 邀请码分享出去但没人理),会一直停在 status='waiting',没有 TTL
-- 的话会在 rooms 表里无限堆积。用 pg_cron 定时清掉超过1小时的这类房间。
--
-- 注意:pg_cron 是 Supabase 的一个扩展,如果下面这行报错说找不到扩展,
-- 去控制台 Database → Extensions 里手动搜 pg_cron 打开一下,再重新跑这一段。
-- ============================================================
create extension if not exists pg_cron;

create or replace function cleanup_stale_rooms()
returns void
language plpgsql
security definer
as $$
begin
  -- 先删关联的邀请通知,避免外键约束挡住房间删除
  delete from game_invites where room_id in (
    select id from rooms where status in ('waiting', 'lobby') and created_at < now() - interval '1 hour'
  );
  delete from rooms where status in ('waiting', 'lobby') and created_at < now() - interval '1 hour';

  -- 结算之后只有一方点了"返回房间"、另一方一直没回来的房间,同样不该无限
  -- 堆在表里——战绩已经写进 match_history 了,删掉房间本身不影响战绩记录
  delete from rooms
  where status = 'finished'
    and (player1_rematch_ready or player2_rematch_ready)
    and updated_at < now() - interval '2 hours';
end;
$$;

-- 重复跑这段 schema.sql 时先把旧的定时任务卸载掉,避免叠加出重复的 cron job
do $$
begin
  perform cron.unschedule('cleanup-stale-rooms');
exception when others then
  null; -- 第一次跑的时候还没有这个任务,unschedule 会报错,忽略掉就好
end $$;

select cron.schedule('cleanup-stale-rooms', '*/30 * * * *', $$select cleanup_stale_rooms();$$);
