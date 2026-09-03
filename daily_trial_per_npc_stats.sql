-- ============================================================
-- 每日试炼评分/战绩拆分成按 NPC 存(第三条修复:第三个 NPC 要上线
-- 之前,林墨/苏晴共用一份评分的问题必须先解决)
-- 在 Supabase 控制台 SQL Editor 里单独运行这一段即可,内容跟
-- schema.sql 里最新版完全一致,重复运行也安全(alter ... if not
-- exists / create or replace / drop ... if exists 全部幂等)。
--
-- 这次改动做了这几件事:
-- 1. profiles 新增 daily_trial_npc_stats(jsonb),按 npc_id 存
--    每位棋手各自的评分/连胜/战绩,不再是账号级别共用一份。
-- 2. 老的 daily_trial_rating / linmo_rating / daily_trial_streak
--    / daily_trial_best_streak / daily_trial_games_played /
--    daily_trial_wins 这六列保留但冻结(不再有任何函数写入),
--    避免破坏性删除;有历史数据(games_played > 0)的账号会被
--    一次性回填进 daily_trial_npc_stats 的 'linmo' 这个 key。
-- 3. daily_trial_games 加一列 npc_id,以后每条战绩记录都带上
--    是跟谁打的(老记录没有,留 null)。
-- 4. get_daily_trial_status / start_daily_trial / finish_daily_trial
--    三个函数都改成必须传 p_npc_id;因为签名变了,脚本里会先
--    显式 drop 掉旧签名的版本,避免重载出两份函数。
-- 5. 新增 daily_trial_npc_entry 辅助函数:取某位棋手的评分条目,
--    不存在就现算一份冷启动初始值(棋力测试做完就用隐藏分当
--    起点,没测过用中性的 50)——新棋手上线不需要跑任何数据
--    迁移,玩家第一次点开跟 TA 的每日试炼自然就会生成。
-- 6. sync_daily_trial_rating_from_skill_test 这个触发器已经没用
--    了(冷启动逻辑挪进了 daily_trial_npc_entry),连带它的触发器
--    一起删除。
-- ============================================================

-- ============================================================
-- 每日试炼(林墨):体力系统 + 钻石 + 玩家/林墨双方动态难度评分
-- ------------------------------------------------------------
-- 设计要点:
-- - 体力(stamina):每天上限 20,每局消耗 5,即"严格来说每天 4 次"——
--   之所以不直接存"今天还能打几次",是因为后面要接"参与活动获得
--   额外体力值",体力是一个可以被别的玩法加值的资源池,存"次数"
--   会绑死这个扩展性,存"点数"才灵活。体力/钻石/经验是账号级别的
--   资源,不分对手,所以还是留在 profiles 的平铺列里。
-- - stamina_date:体力对应的"游戏日"(UTC 自然日)。每次触碰这一行
--   之前先跑一遍 ensure_daily_reset——如果存的日期不是今天,直接刷满
--   到 20,而不是搞每日定时任务去扫全表重置,省一个 cron job,逻辑也
--   更简单(不管玩家隔了一天还是十天没上线,下次一来就是满体力)。
-- - daily_trial_npc_stats:每一位 NPC 各自的隐藏分/连胜/战绩,按
--   npc_id 存成一个 jsonb 对象,不再是账号级别的一对平铺列——
--   起因是苏晴加入之后发现,原来那套 daily_trial_rating/linmo_rating
--   是全账号共用一份,不分跟谁打,而不同棋手的人格差异(见
--   src/game/dailyTrialEngine.js 的 NPC_PERSONALITY)决定了"同样的
--   评分差距"在不同棋手身上对应的实际难度并不一样,共用一份评分会让
--   棋手之间互相污染对方的强度曲线——棋手数量还只有两个的时候还没
--   那么明显,第三个棋手要上线,继续共用肯定出问题,所以现在拆开。
--   每个 npc_id 对应的值形如:
--     { "rating": 玩家在这位棋手面前的隐藏分,
--       "linmo_rating": 这位棋手的隐藏分(字段名沿用"linmo_rating"这个
--         历史命名,不特指林墨,是"对手隐藏分"的意思,不改名是为了
--         少改一处 out 参数名,函数注释里会说清楚),
--       "streak": 跟这位棋手的连胜(正)/连败(负),
--       "best_streak": 跟这位棋手打出过的最佳连胜,
--       "games_played": 跟这位棋手打过多少局,
--       "wins": 跟这位棋手赢过多少局 }
--   某个 npc_id 在这个 jsonb 里不存在,就代表"还没跟这位棋手打过"——
--   见下面 daily_trial_npc_entry 函数,取值时如果不存在就现算一份
--   冷启动初始值,不需要提前为每个 npc_id 建好占位数据,新棋手上线
--   不需要跑任何数据迁移,玩家第一次点开跟 TA 的每日试炼自然就会有。
-- ============================================================
alter table profiles add column if not exists stamina int not null default 20;
alter table profiles add column if not exists stamina_date date not null default (now() at time zone 'utc')::date;
alter table profiles add column if not exists diamonds int not null default 0;
-- 下面这四列 + daily_trial_rating/linmo_rating 是拆分成按 NPC 存之前
-- 的账号级别平铺列,保留下来只是不丢历史数据、不做破坏性删除,
-- 从这次改动起不再有任何函数往这几列写入,新逻辑一律读写下面的
-- daily_trial_npc_stats——如果以后看到某个玩家这几列的值好像很久
-- 没变过,这是预期行为,不是 bug。
alter table profiles add column if not exists daily_trial_rating int not null default 50;
alter table profiles add column if not exists linmo_rating int not null default 50;
alter table profiles add column if not exists daily_trial_streak int not null default 0;
alter table profiles add column if not exists daily_trial_best_streak int not null default 0;
alter table profiles add column if not exists daily_trial_games_played int not null default 0;
alter table profiles add column if not exists daily_trial_wins int not null default 0;
alter table profiles add column if not exists daily_trial_npc_stats jsonb not null default '{}'::jsonb;

-- 之前有一个 sync_daily_trial_rating_from_skill_test 触发器,在棋力
-- 测试完成时把隐藏分同步进 daily_trial_rating/linmo_rating 这两个
-- 平铺列——现在这两列已经不是权威数据源了,继续跑这个触发器只会更新
-- 两列没人再读的死数据,所以直接删掉,冷启动逻辑改成写在
-- daily_trial_npc_entry 里,按每个 npc_id 各自现算,不再是账号级别
-- 只算一次。
drop trigger if exists trg_profiles_sync_daily_trial_rating on profiles;
drop function if exists sync_daily_trial_rating_from_skill_test();

-- 一次性回填:把拆分之前积累的账号级别评分/战绩,原样搬进
-- daily_trial_npc_stats 的 "linmo" 这个 key 里,不然老玩家这次升级
-- 就"丢档"了。注意:如果这个账号在拆分之前其实也打过苏晴(共用同一份
-- 评分,数据本来就是混在一起的),这份回填没法把两位棋手的历史拆干净,
-- 只能整体算作"linmo"的历史起点——这是数据本身的局限,不是回填语句
-- 写错了,拆分之后新产生的数据不会再有这个问题。只回填"确实打过至少
-- 一局每日试炼"(daily_trial_games_played > 0)的玩家,一局没打过的
-- 直接让 daily_trial_npc_entry 现算冷启动值就够了,不需要占位。
update profiles
set daily_trial_npc_stats = daily_trial_npc_stats || jsonb_build_object(
  'linmo', jsonb_build_object(
    'rating', daily_trial_rating,
    'linmo_rating', linmo_rating,
    'streak', daily_trial_streak,
    'best_streak', daily_trial_best_streak,
    'games_played', daily_trial_games_played,
    'wins', daily_trial_wins
  )
)
where daily_trial_games_played > 0
  and not (daily_trial_npc_stats ? 'linmo');

-- 取某位 NPC 的评分/战绩条目,不存在就现算一份冷启动初始值(逻辑
-- 跟以前那个已删掉的触发器一致:棋力测试做完过就拿隐藏分当起点,
-- 双方同一个起点分,没测过就用中性的 50)——纯计算,不碰任何表,
-- 调用方自己决定要不要把返回值写回数据库。
create or replace function daily_trial_npc_entry(p_row profiles, p_npc_id text)
returns jsonb
language plpgsql
as $$
declare
  v_entry jsonb;
  v_seed int;
begin
  v_entry := p_row.daily_trial_npc_stats -> p_npc_id;
  if v_entry is null then
    v_seed := case
      when p_row.skill_test_status = 'completed' and p_row.skill_test_hidden_score is not null
      then greatest(0, least(100, p_row.skill_test_hidden_score))
      else 50
    end;
    v_entry := jsonb_build_object(
      'rating', v_seed, 'linmo_rating', v_seed,
      'streak', 0, 'best_streak', 0, 'games_played', 0, 'wins', 0
    );
  end if;
  return v_entry;
end;
$$;

-- 每日试炼历史记录:不是核心链路的强依赖(体力/评分都已经写回
-- profiles 了),留痕主要是为了以后做成就系统("连胜XX场"这类需要
-- 回溯历史)、以及排查"这个玩家的分数怎么变成这样"时有据可查。
create table if not exists daily_trial_games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  npc_id text, -- 打的是哪位棋手;这张表在拆分成按 NPC 存评分之前就有了,
    -- 老数据没有这一列的值(留 null,代表"不知道是跟谁打的",不能倒推),
    -- 从这次改动起新写入的每一行都会带上。
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
alter table daily_trial_games add column if not exists npc_id text;
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
-- p_npc_id 必填,因为评分现在按棋手分开存了(见 daily_trial_npc_entry);
-- 这里只是读,不会把冷启动算出来的初始值持久化,真正落库发生在
-- start_daily_trial 第一次跟这位棋手开打的那一刻。
-- 参数签名变了(多了 p_npc_id),先把旧的零参数版本删掉——
-- create or replace 只在签名完全一致时才会真正替换,签名不一样会
-- 变成重载出一个新函数,旧版本会留在数据库里没人管。
drop function if exists get_daily_trial_status();
create or replace function get_daily_trial_status(p_npc_id text)
returns table (
  out_stamina int, out_diamonds int, out_rating int, out_linmo_rating int,
  out_streak int, out_best_streak int, out_games_played int, out_wins int
)
language plpgsql
security definer
as $$
declare
  me uuid;
  v_row profiles%rowtype;
  v_entry jsonb;
begin
  me := auth.uid();
  if me is null then
    raise exception '未登录';
  end if;
  if p_npc_id is null or length(trim(p_npc_id)) = 0 then
    raise exception '缺少棋手标识';
  end if;

  perform ensure_daily_reset(me);

  select * into v_row from profiles where id = me;
  v_entry := daily_trial_npc_entry(v_row, p_npc_id);

  out_stamina := v_row.stamina;
  out_diamonds := v_row.diamonds;
  out_rating := (v_entry->>'rating')::int;
  out_linmo_rating := (v_entry->>'linmo_rating')::int;
  out_streak := (v_entry->>'streak')::int;
  out_best_streak := (v_entry->>'best_streak')::int;
  out_games_played := (v_entry->>'games_played')::int;
  out_wins := (v_entry->>'wins')::int;

  return next;
end;
$$;

-- 开始一局每日试炼:处理每日重置 + 校验并原子扣减体力(for update
-- 行锁防止连点两次同时通过校验、体力被多扣一次)。返回扣完之后的
-- 最新状态,前端拿玩家分/对手分去初始化这一局的强度旋钮。
-- p_npc_id 必填——这里是"跟这位棋手的评分条目"第一次真正落库的地方:
-- 如果这个玩家还没跟这位棋手打过,daily_trial_npc_entry 现算出来的
-- 冷启动值会被原样写回 daily_trial_npc_stats,后面 finish_daily_trial
-- 就能放心假设这个 key 一定存在了。
-- 参数签名变了(多了 p_npc_id 且顺序在前),先删旧版本,理由同上。
drop function if exists start_daily_trial(int);
create or replace function start_daily_trial(p_npc_id text, p_stamina_cost int default 5)
returns table (
  out_stamina int, out_diamonds int, out_rating int, out_linmo_rating int, out_streak int
)
language plpgsql
security definer
as $$
declare
  me uuid;
  v_row profiles%rowtype;
  v_entry jsonb;
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

  out_stamina := v_row.stamina - p_stamina_cost;
  out_diamonds := v_row.diamonds;
  out_rating := (v_entry->>'rating')::int;
  out_linmo_rating := (v_entry->>'linmo_rating')::int;
  out_streak := (v_entry->>'streak')::int;

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
-- - 对手分不直接等于玩家新分,而是朝着"玩家新分"这个目标走 30% 的
--   差距(不是瞬间拉平)——之前这里给目标加过 +3 的"棋高一手"常数,
--   后来发现这会让长期均衡胜率略低于设计目标的 55%-65% 区间,已经
--   去掉,目标就是玩家当前分本身。
-- - quality 由客户端算好传过来,但服务器强制 clamp 到 [0,1],不完全
--   信任这个数字本身,只把它当"锦上添花"的一个输入,不是决定性因素
--   (核心的 60% 权重仍然来自服务器自己判定的 result)。
-- - p_npc_id 必填,决定这一局的输赢算在 daily_trial_npc_stats 的
--   哪个 key 下面;正常流程里这个 key 在 start_daily_trial 那一步已经
--   落库过了,这里 daily_trial_npc_entry 只是防御性兜底(比如客户端
--   跳过 start 直接调 finish 之类的异常路径),不依赖它一定存在。
-- - 棋风画像的"计算力"这一维仍然是账号级别(不分对手)更新,理由见
--   下面那段注释,拆分评分这件事不影响这一块。
-- 参数签名变了(多了 p_npc_id 且顺序在前),先删旧版本,理由同上。
drop function if exists finish_daily_trial(text, numeric);
create or replace function finish_daily_trial(
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

  -- 棋风画像的"计算力"这一维,每局顺手用滑动平均更新一下(轻量版,
  -- 只动这一维,不碰其他五维):v_quality 就是这一局"实际选点/理论
  -- 最优选点"的比值,跟 lib/skillProfile.js 的 calcScore 是同一个口径,
  -- 换算成 0-100 就是这一局单独拿出来测,计算力大概是多少分。
  -- 旧值权重 0.7、新局权重 0.3——既能让长期趋势慢慢浮现,又不会因为
  -- 一局发挥失常/超常就把画像甩到另一个极端。只在玩家已经做过棋风
  -- 测试(skill_test_status = 'completed' 且 skill_test_dims 不是 null)
  -- 时才更新,没测过的人不凭空生造出一份只有一维有数据的"画像"。这一
  -- 维不分跟哪位棋手打的,任何一场每日试炼都算数——"计算力"衡量的是
  -- 玩家自己的落子质量,不是某个对手特有的东西。
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

  insert into daily_trial_games (
    player_id, npc_id, result, quality, player_rating_before, player_rating_after,
    linmo_rating_before, linmo_rating_after, exp_awarded, diamonds_awarded
  ) values (
    me, p_npc_id, p_result, v_quality, v_rating, v_new_rating,
    v_linmo, v_new_linmo, v_exp_gain, v_diamond_gain
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
