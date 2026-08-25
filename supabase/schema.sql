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
  exp int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  is_guest boolean not null default false, -- 浏览器调试用的匿名账号,不是真实Telegram用户
  nickname_confirmed boolean not null default false, -- 首次进入时是否已经过"确认昵称"这一步;
                                                       -- 没确认之前 display_name 只是从 Telegram 自动带过来的默认值
  created_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目
-- 兼容已经建过表的老项目:成长值改版(概念从"积分/rating"改名为"经验值/exp",
-- 只涨不降,赢/输/和都直接加分,不再有负分)。如果老库里这一列还叫 rating,
-- 先把列名改过来,数据(玩家已经攒的分数)原样保留,只是改了个名字。
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'rating')
     and not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'exp') then
    alter table profiles rename column rating to exp;
  end if;
end $$;
alter table profiles alter column exp set default 0;

alter table profiles add column if not exists is_guest boolean not null default false;
alter table profiles add column if not exists nickname_confirmed boolean not null default false;
-- 单设备登录:每次真正登录成功(不是同一设备缓存态重开 App)就生成一个
-- 新的 active_session_id,写进这一行。别的设备(如果还留着旧的 session_id)
-- 靠订阅这一行的 realtime UPDATE 几乎实时发现自己"过期"了,自动登出。
alter table profiles add column if not exists active_session_id uuid;

-- 棋力测试(林墨):新用户认识林墨、确认昵称之后,紧接着邀请下一局"考官式"
-- 测试局,目的不是给玩家打分定级(不跟 exp/段位挂钩),而是给"每日试炼"
-- 功能一个冷启动的难度匹配起点,同时包装成六维风格画像展示给玩家看。
-- status: pending(还没测,新老用户默认都是这个) | completed(测完了) | skipped(邀请时选了"改天吧"/中途放弃)
-- dims: 六维风格分(展示用) {attack,defense,vision,calc,opening,adapt},0-100
-- type: 棋手类型 key,对应 src/lib/skillProfile.js 里 TYPE_DEFS 的键名
-- hidden_score: 隐藏综合水平分(不展示),每日试炼定初始难度用
-- confidence: 这次测试结果的置信度(none/low/medium),关卡触发得越少越低,
--   每日试炼消费这个分数时应该按置信度决定要不要放宽初期难度浮动范围
-- raw: 原始信号(逐步棋谱 + 关卡事件 + 开局采样),供以后重新设计六维算法/
--   校准算法时回溯使用,不需要因为算法迭代重新收集数据
alter table profiles add column if not exists skill_test_status text not null default 'pending';
alter table profiles add column if not exists skill_test_dims jsonb;
alter table profiles add column if not exists skill_test_type text;
alter table profiles add column if not exists skill_test_hidden_score int;
alter table profiles add column if not exists skill_test_confidence text;
alter table profiles add column if not exists skill_test_raw jsonb;
alter table profiles add column if not exists skill_test_completed_at timestamptz;

-- 棋力测试历史:上面 profiles.skill_test_* 那几列只留"最新一次"的快照,
-- 每次复测都会被直接覆盖掉——这张表反过来专门留存"每一次"的结果,
-- 用来支持"这次跟上次比怎么样""最近这段时间感觉如何"这类需要看
-- 多次记录才能说清楚的点评。每次测试完成(不管是新用户第一次测,还是
-- 从"我的"页面发起的复测)都会插入一行,不会覆盖、不会删除。
-- dims/type/hidden_score/confidence 字段含义跟 profiles 上同名列一致,
-- 复制一份存历史行里是为了不用回头 join/依赖 profiles 当前值(那一列
-- 会被后续的测试覆盖掉)。
create table if not exists skill_test_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  dims jsonb not null,
  type text not null,
  hidden_score int,
  confidence text,
  completed_at timestamptz not null default now()
);

create index if not exists skill_test_history_profile_idx
  on skill_test_history (profile_id, completed_at desc);

alter table skill_test_history enable row level security;

drop policy if exists "skill_test_history_select" on skill_test_history;
create policy "skill_test_history_select" on skill_test_history for select using (auth.uid() = profile_id);

drop policy if exists "skill_test_history_insert" on skill_test_history;
create policy "skill_test_history_insert" on skill_test_history for insert with check (auth.uid() = profile_id);

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
  exp int not null default 0,
  created_at timestamptz not null default now()
);

-- 兼容已经建过表的老项目:matchmaking_queue.rating 列同步改名为 exp
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'matchmaking_queue' and column_name = 'rating')
     and not exists (select 1 from information_schema.columns where table_name = 'matchmaking_queue' and column_name = 'exp') then
    alter table matchmaking_queue rename column rating to exp;
  end if;
end $$;
alter table matchmaking_queue alter column exp set default 0;

-- 兼容已经建过表的老项目:补上 end_reason 字段
alter table rooms add column if not exists end_reason text default 'normal';

-- 判负兜底用:回合截止时间 + 双方最后心跳时间,服务端定时任务靠这三个
-- 字段权威判定超时/掉线,不再依赖某一台设备的浏览器是否还醒着(详见
-- 文件后面 check_timeouts 那一段的说明)
alter table rooms add column if not exists turn_deadline timestamptz;
alter table rooms add column if not exists player1_last_seen timestamptz;
alter table rooms add column if not exists player2_last_seen timestamptz;

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
create or replace function match_players(me uuid, my_exp int default 0)
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
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn, turn_deadline, player1_last_seen, player2_last_seen)
    values ('matchmaking', 'playing', opponent.player_id, me,
      (select jsonb_agg(0) from generate_series(1, 225)), 1,
      now() + interval '30 seconds', now(), now())
    returning id into new_room_id;

    delete from matchmaking_queue where player_id = opponent.player_id;
    return new_room_id;
  else
    -- 没找到,自己进队列等待,返回 null 表示"请等待"
    insert into matchmaking_queue (player_id, exp) values (me, my_exp);
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
-- 用 pg_publication_tables 先查一下有没有加过,避免整段 schema.sql 重跑时
-- 在这一行直接报错中断(alter publication add table 对已经加过的表会报错,
-- 不像 create table 那样有 if not exists 可用)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table rooms;
  end if;
end $$;

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
    insert into rooms (mode, status, player1_id, player2_id, board, current_turn, rematch_of, turn_deadline, player1_last_seen, player2_last_seen)
    values (old_room.mode, 'playing', old_room.player2_id, old_room.player1_id,
      (select jsonb_agg(0) from generate_series(1, 225)), 1, p_old_room_id,
      now() + interval '30 seconds', now(), now())
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

  select id, display_name, avatar_url, exp into target
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
    'avatar_url', target.avatar_url, 'exp', target.exp
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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table friend_requests;
  end if;
end $$;

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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_invites'
  ) then
    alter publication supabase_realtime add table game_invites;
  end if;
end $$;

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
-- 战绩记录 + 经验值(只涨不降)系统
-- ============================================================
create table if not exists match_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id),
  player1_id uuid references profiles(id),
  player2_id uuid references profiles(id),
  winner int, -- 0=平局 1/2=对应玩家
  end_reason text default 'normal',
  player1_exp_before int,
  player2_exp_before int,
  player1_exp_after int,
  player2_exp_after int,
  created_at timestamptz not null default now()
);

alter table match_history add column if not exists end_reason text default 'normal';

-- 兼容已经建过表的老项目:match_history 里原来叫 xxx_rating_xxx 的四列同步改名成 xxx_exp_xxx
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'match_history' and column_name = 'player1_rating_before') then
    alter table match_history rename column player1_rating_before to player1_exp_before;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'match_history' and column_name = 'player2_rating_before') then
    alter table match_history rename column player2_rating_before to player2_exp_before;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'match_history' and column_name = 'player1_rating_after') then
    alter table match_history rename column player1_rating_after to player1_exp_after;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'match_history' and column_name = 'player2_rating_after') then
    alter table match_history rename column player2_rating_after to player2_exp_after;
  end if;
end $$;

alter table match_history enable row level security;

drop policy if exists "history_select" on match_history;
create policy "history_select" on match_history for select using (
  auth.uid() = player1_id or auth.uid() = player2_id
);

-- 结束一局对战:计算经验值(只涨不降)、更新双方 profiles、写历史、关闭房间
-- 用 security definer 是因为普通玩家的 RLS 权限改不了对方的 exp
-- p_reason: normal(五连/平局) | forfeit(主动认输离开) | disconnect(对方掉线超时,由在线一方判负)
-- 经验值规则:赢一局 +10,输一局 +4,和棋 +6;只涨不降,没有扣分/负分
create or replace function finish_match(p_room_id uuid, p_winner int, p_reason text default 'normal')
returns jsonb
language plpgsql
security definer
as $$
declare
  r rooms%rowtype;
  p1 profiles%rowtype;
  p2 profiles%rowtype;
  win_exp int := 10;
  lose_exp int := 4;
  draw_exp int := 6;
  delta1 int; delta2 int;
  new1 int; new2 int;
begin
  select * into r from rooms where id = p_room_id for update;

  if r.id is null then
    return jsonb_build_object('error', '房间不存在');
  end if;

  -- 安全修复:必须是这局对局的参与者才能结算它,否则任何登录用户随便传个 room_id
  -- 和 winner 就能篡改别人的对局结果和经验值
  if auth.uid() is null or (auth.uid() <> r.player1_id and auth.uid() <> r.player2_id) then
    return jsonb_build_object('error', '无权限操作该对局');
  end if;

  if r.status = 'finished' then
    return jsonb_build_object('already_finished', true);
  end if;

  select * into p1 from profiles where id = r.player1_id;
  select * into p2 from profiles where id = r.player2_id;

  if p_winner = 1 then delta1 := win_exp; delta2 := lose_exp;
  elsif p_winner = 2 then delta1 := lose_exp; delta2 := win_exp;
  else delta1 := draw_exp; delta2 := draw_exp;
  end if;

  new1 := p1.exp + delta1;
  new2 := p2.exp + delta2;

  update profiles set
    exp = new1,
    wins = wins + (case when p_winner = 1 then 1 else 0 end),
    losses = losses + (case when p_winner = 2 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p1.id;

  update profiles set
    exp = new2,
    wins = wins + (case when p_winner = 2 then 1 else 0 end),
    losses = losses + (case when p_winner = 1 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p2.id;

  update rooms set status = 'finished', winner = p_winner, end_reason = p_reason where id = p_room_id;

  insert into match_history (
    room_id, player1_id, player2_id, winner, end_reason,
    player1_exp_before, player2_exp_before, player1_exp_after, player2_exp_after
  ) values (
    p_room_id, p1.id, p2.id, p_winner, p_reason, p1.exp, p2.exp, new1, new2
  );

  return jsonb_build_object(
    'my1_delta', new1 - p1.exp, 'my2_delta', new2 - p2.exp,
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
      status = 'lobby', board = (select jsonb_agg(0) from generate_series(1, 225)), current_turn = 1, winner = null,
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

-- ============================================================
-- 判负兜底(服务端权威) + 单设备登录会话控制
-- ============================================================
-- 背景:之前"回合超时判负"根本没实现(计时器纯展示),"掉线判负"则完全
-- 靠还在线那一方的浏览器自己跑定时器、自己调 RPC——一旦双方都不在前台
-- (比如 Telegram Mini App 被切到后台,JS 定时器被系统挂起),没有任何
-- 一端在执行判负逻辑,对局会永久卡死在 playing。
--
-- 现在把"回合截止时间"和"最后心跳时间"都落到 rooms 表里,由服务端
-- pg_cron 定时扫描、权威判定,不再依赖某一台设备的浏览器是否醒着。
-- 客户端原有的即时提示(断线倒计时展示、回合倒计时展示)保留,作为
-- "体验更快的快速路径";这里加的是"就算没人盯着也一定会兜底"的保证。

-- 关键写操作(落子、认输)额外校验一下调用方带的 session_id 是否还是
-- 最新的,双保险——万一旧设备的 realtime 订阅因为网络问题没收到通知,
-- 落子/认输这类核心请求也会在服务端被拒绝,而不是"客户端没收到通知就
-- 一直能用"。p_session_id 允许传 null(向后兼容旧客户端/内部调用),
-- 只有真正传了值又对不上时才拦。
create or replace function _validate_session(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  current_sid uuid;
begin
  if p_session_id is null then return; end if;
  select active_session_id into current_sid from profiles where id = me;
  if current_sid is not null and current_sid <> p_session_id then
    raise exception 'SESSION_SUPERSEDED' using errcode = 'P0001';
  end if;
end;
$$;

-- 把 finish_match 原本的核心逻辑抽出来,去掉"必须是参与者本人在调用"
-- 这条校验——这条校验对玩家主动触发(认输/五连获胜上报)是必须的,
-- 但对 check_timeouts 这种系统级定时任务(没有 auth.uid() 上下文)和
-- claim_session 这种"新设备登录顶替旧设备正在进行的对局"的场景不适用。
-- finish_match 本身改成一层薄薄的权限校验壳,校验完再委托给这个内部函数。
-- 经验值规则:赢一局 +10,输一局 +4,和棋 +6;只涨不降,没有扣分/负分
create or replace function _finish_match_internal(p_room_id uuid, p_winner int, p_reason text)
returns jsonb
language plpgsql
security definer
as $$
declare
  r rooms%rowtype;
  p1 profiles%rowtype;
  p2 profiles%rowtype;
  win_exp int := 10;
  lose_exp int := 4;
  draw_exp int := 6;
  delta1 int; delta2 int;
  new1 int; new2 int;
begin
  select * into r from rooms where id = p_room_id for update;

  if r.id is null then
    return jsonb_build_object('error', '房间不存在');
  end if;

  if r.status = 'finished' then
    return jsonb_build_object('already_finished', true);
  end if;

  select * into p1 from profiles where id = r.player1_id;
  select * into p2 from profiles where id = r.player2_id;

  if p_winner = 1 then delta1 := win_exp; delta2 := lose_exp;
  elsif p_winner = 2 then delta1 := lose_exp; delta2 := win_exp;
  else delta1 := draw_exp; delta2 := draw_exp;
  end if;

  new1 := p1.exp + delta1;
  new2 := p2.exp + delta2;

  update profiles set
    exp = new1,
    wins = wins + (case when p_winner = 1 then 1 else 0 end),
    losses = losses + (case when p_winner = 2 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p1.id;

  update profiles set
    exp = new2,
    wins = wins + (case when p_winner = 2 then 1 else 0 end),
    losses = losses + (case when p_winner = 1 then 1 else 0 end),
    draws = draws + (case when p_winner = 0 then 1 else 0 end)
  where id = p2.id;

  update rooms set status = 'finished', winner = p_winner, end_reason = p_reason where id = p_room_id;

  insert into match_history (
    room_id, player1_id, player2_id, winner, end_reason,
    player1_exp_before, player2_exp_before, player1_exp_after, player2_exp_after
  ) values (
    p_room_id, p1.id, p2.id, p_winner, p_reason, p1.exp, p2.exp, new1, new2
  );

  return jsonb_build_object(
    'my1_delta', new1 - p1.exp, 'my2_delta', new2 - p2.exp,
    'p1_new', new1, 'p2_new', new2
  );
end;
$$;

-- p_reason 现在可能的取值:normal | forfeit | disconnect | timeout(回合超时,
-- 服务端兜底判定) | session_kicked(别处登录顶替,旧设备的对局被强制判负)
--
-- 注意:新签名比原来的 finish_match(uuid, int, text) 多了一个参数,
-- create or replace 按参数签名区分函数,不会覆盖旧的三参数版本,得先
-- 显式 drop 掉,不然新旧两个 finish_match 会同时存在——旧的那个没有
-- session 校验,等于开了个后门。
drop function if exists finish_match(uuid, int, text);

create or replace function finish_match(p_room_id uuid, p_winner int, p_reason text default 'normal', p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
as $$
begin
  if auth.uid() is null or (
    auth.uid() <> (select player1_id from rooms where id = p_room_id)
    and auth.uid() <> (select player2_id from rooms where id = p_room_id)
  ) then
    return jsonb_build_object('error', '无权限操作该对局');
  end if;

  perform _validate_session(p_session_id);

  return _finish_match_internal(p_room_id, p_winner, p_reason);
end;
$$;

grant execute on function finish_match(uuid, int, text, uuid) to authenticated;

-- 房主"开始对局"改成走 RPC(原来是前端直接 update status),顺便在这里
-- 落下第一手的回合截止时间、给双方种一个初始心跳,避免游戏刚开始那几秒
-- last_seen 是 null,被 check_timeouts 误判成"从未心跳过 = 早就该判负"。
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

  -- board 必须是满 225 格(15x15)的零数组再交给 make_move——jsonb_set 按
  -- 下标写入要求目标数组本来就"够长",如果还是初始的 '[]' 空数组,落子时
  -- 写到中间某个下标会直接失败,所以这里先补满。
  update rooms set
    status = 'playing',
    board = (select jsonb_agg(0) from generate_series(1, 225)),
    turn_deadline = now() + interval '30 seconds',
    player1_last_seen = now(),
    player2_last_seen = now()
  where id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function start_match(uuid) to authenticated;

-- 落子改走 RPC(原来是前端直接 update rooms 表)。除了原本的写棋盘,
-- 顺带做两件事:1) 校验确实轮到我、这一格确实空着——之前这层校验完全
-- 没有,客户端传什么服务端就信什么;2) 刷新 turn_deadline,给"下一手"
-- 重新计时,配合 check_timeouts 做超时判负。
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
  board jsonb;
  cell int;
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
  board := r.board;
  cell := (board->>idx)::int; -- ->> 按下标取值再转text,jsonb array直接转int会报错,得先转text
  if cell <> 0 then return jsonb_build_object('error', '这一格已经有子了'); end if;

  board := jsonb_set(board, array[idx::text], to_jsonb(my_slot));

  update rooms set
    board = board,
    current_turn = case when my_slot = 1 then 2 else 1 end,
    move_count = r.move_count + 1,
    board_before_last_move = r.board,
    undo_requested_by = null,
    turn_deadline = now() + interval '30 seconds',
    player1_last_seen = case when my_slot = 1 then now() else player1_last_seen end,
    player2_last_seen = case when my_slot = 2 then now() else player2_last_seen end
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'move_count', r.move_count + 1);
end;
$$;

grant execute on function make_move(uuid, int, int, uuid) to authenticated;

-- 心跳:对局进行中客户端每隔几秒调一次,只是刷新"我还在"这个时间戳,
-- 不改棋盘本身。掉线判负不再单纯依赖 presence 的 leave 事件+对方浏览器
-- 是否醒着,check_timeouts 直接看这个字段是否太久没更新。
create or replace function heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  r rooms%rowtype;
begin
  if me is null then return; end if;
  select * into r from rooms where id = p_room_id;
  if r.id is null or r.status <> 'playing' then return; end if;
  if me = r.player1_id then
    update rooms set player1_last_seen = now() where id = p_room_id;
  elsif me = r.player2_id then
    update rooms set player2_last_seen = now() where id = p_room_id;
  end if;
end;
$$;

grant execute on function heartbeat(uuid) to authenticated;

-- 悔棋被同意之后棋盘退回上一步、轮到发起悔棋的一方重新走——顺带把
-- turn_deadline 也刷新一下,不然回合截止时间还停在"被悔掉的那一步"
-- 落子之前算出来的旧值上,悔棋一同意可能立刻就被 check_timeouts 判成
-- 超时。同一函数签名,这里直接覆盖原来的定义。
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
      undo_requested_by = null,
      turn_deadline = now() + interval '30 seconds'
    where id = p_room_id;
    return jsonb_build_object('accepted', true);
  else
    update rooms set undo_requested_by = null where id = p_room_id;
    return jsonb_build_object('accepted', false);
  end if;
end;
$$;

-- 单设备登录:真正的"登录"动作(不是同一设备缓存 session 重开 App)调这个。
-- 两阶段:
--   1) p_force=false 先探测一下,这个账号是不是有别的设备正在 playing 中
--      的对局——有的话不动 active_session_id,直接把 room_id 报回去,前端
--      弹确认框("继续登录会判那局负,是否继续?")
--   2) 用户确认后,前端带 p_force=true 再调一次:这时候才会真正顶掉旧设备
--      (判负旧设备那局对局 + 生成新 active_session_id)。如果压根没有进行
--      中的对局,第一次调用(p_force=false)就会直接完成顶替,不需要走两步。
create or replace function claim_session(p_force boolean default false)
returns jsonb
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  active_room rooms%rowtype;
  opp_slot int;
  new_sid uuid;
begin
  if me is null then raise exception '未登录'; end if;

  select * into active_room from rooms
  where (player1_id = me or player2_id = me) and status = 'playing'
  order by updated_at desc limit 1;

  if active_room.id is not null and not p_force then
    return jsonb_build_object('has_active_game', true, 'room_id', active_room.id);
  end if;

  if active_room.id is not null and p_force then
    opp_slot := case when active_room.player1_id = me then 2 else 1 end;
    perform _finish_match_internal(active_room.id, opp_slot, 'session_kicked');
  end if;

  new_sid := gen_random_uuid();
  update profiles set active_session_id = new_sid where id = me;

  return jsonb_build_object('session_id', new_sid);
end;
$$;

grant execute on function claim_session(boolean) to authenticated;

-- profiles 加入 Realtime 发布:旧设备靠订阅自己这一行的 UPDATE,几乎实时
-- 发现 active_session_id 被换掉了(别处登录顶替了),自动登出
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
end $$;

-- 服务端权威判负扫描:pg_cron 定时跑,不依赖任何一台设备的浏览器还醒着。
--   · 回合超时:now() > turn_deadline,当前该走棋的一方判负,reason='timeout'
--   · 掉线超时:某一方的心跳时间戳太久没刷新(用 coalesce 兜底,处理"游戏
--     刚开始/刚重连,还没来得及心跳一次"的情况),判他负,reason='disconnect'
-- 注意精度取舍:pg_cron 标准语法最小粒度是"分钟",这里每分钟跑一次,
-- 意味着实际生效时间比 turn_deadline/心跳阈值本身要晚最多接近60秒。
-- 如果想要更接近现在客户端 20~30 秒那种即时感,需要额外接一个更高频率
-- 的外部触发器(比如 Cloudflare Cron Triggers 每15秒调一次同名逻辑的
-- edge function),这里先给出零额外基础设施依赖的兜底版本。
create or replace function check_timeouts()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  loser int;
  winner int;
  p1_last timestamptz;
  p2_last timestamptz;
begin
  for r in select * from rooms where status = 'playing' for update skip locked loop
    -- 回合超时判负
    if r.turn_deadline is not null and now() > r.turn_deadline then
      loser := r.current_turn;
      winner := case when loser = 1 then 2 else 1 end;
      perform _finish_match_internal(r.id, winner, 'timeout');
      continue;
    end if;

    -- 掉线判负:没心跳过就用 updated_at 兜底,不然刚开局/刚重连那几秒
    -- 会被误判成"早就该判负"
    p1_last := coalesce(r.player1_last_seen, r.updated_at);
    p2_last := coalesce(r.player2_last_seen, r.updated_at);

    if now() - p1_last > interval '45 seconds' then
      perform _finish_match_internal(r.id, 2, 'disconnect');
    elsif now() - p2_last > interval '45 seconds' then
      perform _finish_match_internal(r.id, 1, 'disconnect');
    end if;
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('check-timeouts');
exception when others then
  null;
end $$;

select cron.schedule('check-timeouts', '* * * * *', $$select check_timeouts();$$);

-- ============================================================
-- 每日试炼(林墨):体力系统 + 钻石 + 玩家/林墨双方动态难度评分
-- ------------------------------------------------------------
-- 设计要点:
-- - 体力(stamina):每天上限 20,每局消耗 5,即"严格来说每天 4 次"——
--   之所以不直接存"今天还能打几次",是因为后面要接"参与活动获得
--   额外体力值",体力是一个可以被别的玩法加值的资源池,存"次数"
--   会绑死这个扩展性,存"点数"才灵活。
-- - stamina_date:体力对应的"游戏日"(UTC 自然日)。每次触碰这一行
--   之前先跑一遍 ensure_daily_reset——如果存的日期不是今天,直接刷满
--   到 20,而不是搞每日定时任务去扫全表重置,省一个 cron job,逻辑也
--   更简单(不管玩家隔了一天还是十天没上线,下次一来就是满体力)。
-- - daily_trial_rating / linmo_rating:双方各自的隐藏分(0-100,同一
--   量纲、同一个刻度,跟 skill_test_hidden_score 保持一致,方便冷启动
--   时直接拿棋力测试的分数当起点)。玩家分数每局按类 ELO 公式更新,
--   林墨分数每局都朝玩家最新分数追一部分(不是瞬间拉平),这样"越打
--   林墨越强"是一个能被玩家感知到的渐进过程,而不是每局重新计算出
--   一个新数字这么冷冰冰。
-- - daily_trial_streak:连胜为正、连败为负,任意一局和棋清零——这个
--   数字直接喂给客户端算这一局林墨的强度旋钮(见
--   src/game/dailyTrialEngine.js 的 streakAdjustment),也是以后做
--   连胜称号/成就时现成能用的字段。
-- ============================================================
alter table profiles add column if not exists stamina int not null default 20;
alter table profiles add column if not exists stamina_date date not null default (now() at time zone 'utc')::date;
alter table profiles add column if not exists diamonds int not null default 0;
alter table profiles add column if not exists daily_trial_rating int not null default 50;
alter table profiles add column if not exists linmo_rating int not null default 50;
alter table profiles add column if not exists daily_trial_streak int not null default 0;
alter table profiles add column if not exists daily_trial_best_streak int not null default 0;
alter table profiles add column if not exists daily_trial_games_played int not null default 0;
alter table profiles add column if not exists daily_trial_wins int not null default 0;

-- 每日试炼历史记录:不是核心链路的强依赖(体力/评分都已经写回
-- profiles 了),留痕主要是为了以后做成就系统("连胜XX场"这类需要
-- 回溯历史)、以及排查"这个玩家的分数怎么变成这样"时有据可查。
create table if not exists daily_trial_games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  result text not null check (result in ('win', 'lose', 'draw')),
  quality numeric,
  player_rating_before int,
  player_rating_after int,
  linmo_rating_before int,
  linmo_rating_after int,
  stamina_spent int not null default 5,
  exp_awarded int not null default 0,
  diamonds_awarded int not null default 0,
  created_at timestamptz not null default now()
);
alter table daily_trial_games enable row level security;
drop policy if exists "daily_trial_games_select" on daily_trial_games;
create policy "daily_trial_games_select" on daily_trial_games for select using (auth.uid() = player_id);
-- 没有 insert 策略:这张表只由下面 finish_daily_trial(security definer)
-- 写入,客户端不能绕过评分/奖励逻辑直接插一条自己捏造的战绩。

-- 每日重置:内部辅助函数,不直接暴露给客户端当"公开工具"用——虽然
-- 客户端理论上也能通过 PostgREST 直接 rpc 调用,但这里显式校验
-- p_uid = auth.uid(),就算被直接调用,最多也只能把自己的体力刷新
-- 成"今天该有的样子",不存在越权改别人数据的风险。
create or replace function ensure_daily_reset(p_uid uuid)
returns void
language plpgsql
security definer
as $$
begin
  if p_uid <> auth.uid() then
    raise exception '无权限';
  end if;
  update profiles
  set stamina = 20, stamina_date = (now() at time zone 'utc')::date
  where id = p_uid and stamina_date <> (now() at time zone 'utc')::date;
end;
$$;

-- 每日试炼首页进入时调用:只做"该不该刷新体力"这件事,再把最新状态
-- 读出来,用来渲染体力条/钻石/连胜——不消耗任何体力,纯查询语义。
create or replace function get_daily_trial_status()
returns table (
  out_stamina int, out_diamonds int, out_rating int, out_linmo_rating int,
  out_streak int, out_best_streak int, out_games_played int, out_wins int
)
language plpgsql
security definer
as $$
declare
  me uuid;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;

  perform ensure_daily_reset(me);

  select stamina, diamonds, daily_trial_rating, linmo_rating, daily_trial_streak,
         daily_trial_best_streak, daily_trial_games_played, daily_trial_wins
  into out_stamina, out_diamonds, out_rating, out_linmo_rating, out_streak,
       out_best_streak, out_games_played, out_wins
  from profiles where id = me;

  return next;
end;
$$;

-- 开始一局每日试炼:处理每日重置 + 校验并原子扣减体力(for update
-- 行锁防止连点两次同时通过校验、体力被多扣一次)。返回扣完之后的
-- 最新状态,前端拿玩家分/林墨分去初始化这一局的强度旋钮。
create or replace function start_daily_trial(p_stamina_cost int default 5)
returns table (
  out_stamina int, out_diamonds int, out_rating int, out_linmo_rating int, out_streak int
)
language plpgsql
security definer
as $$
declare
  me uuid;
  v_row profiles%rowtype;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;

  perform ensure_daily_reset(me);

  select * into v_row from profiles where id = me for update;

  if v_row.stamina < p_stamina_cost then
    raise exception '体力不足';
  end if;

  update profiles set stamina = profiles.stamina - p_stamina_cost where id = me;

  select stamina, diamonds, daily_trial_rating, linmo_rating, daily_trial_streak
  into out_stamina, out_diamonds, out_rating, out_linmo_rating, out_streak
  from profiles where id = me;

  return next;
end;
$$;

-- 结算一局每日试炼(体力已经在 start_daily_trial 那一步扣过了,这里
-- 只做"赢/输/和之后该发生什么"):
-- - 类 ELO 更新玩家隐藏分:expected 用双方当前分差算出"按理说玩家该
--   有多大胜率",actual 不是单纯 0/1 的胜负,而是"胜负结果(60%权重)
--   + 这一局的过程质量分(40%权重)"混合出来的——赢得很勉强(质量分低)
--   涨分会比"赢得干净利落"更少,反过来,虽败犹荣(质量分高)也能比
--   "一败涂地"多回一点血,不是纯粹的赌输赢。
-- - 林墨分不直接等于玩家新分,而是朝着"玩家新分"这个目标走 30% 的
--   差距(不是瞬间拉平)——之前这里给目标加过 +3 的"棋高一手"常数,
--   后来发现这会让长期均衡胜率略低于设计目标的 55%-65% 区间,已经
--   去掉,目标就是玩家当前分本身。
-- - quality 由客户端算好传过来,但服务器强制 clamp 到 [0,1],不完全
--   信任这个数字本身,只把它当"锦上添花"的一个输入,不是决定性因素
--   (核心的 60% 权重仍然来自服务器自己判定的 result)。
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

  update profiles set
    exp = profiles.exp + v_exp_gain,
    diamonds = profiles.diamonds + v_diamond_gain,
    daily_trial_rating = v_new_rating,
    linmo_rating = v_new_linmo,
    daily_trial_streak = v_new_streak,
    daily_trial_best_streak = greatest(profiles.daily_trial_best_streak, v_new_streak),
    daily_trial_games_played = profiles.daily_trial_games_played + 1,
    daily_trial_wins = profiles.daily_trial_wins + (case when p_result = 'win' then 1 else 0 end)
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
