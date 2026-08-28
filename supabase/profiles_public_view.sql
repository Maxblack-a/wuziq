-- ============================================================
-- P1 加固:profiles 表现在对所有登录用户全字段可读,收紧成
-- "自己的行能看到全部字段,别人的行只能通过一个只读安全视图看到
-- 几个明确允许公开的字段"。
--
-- 背景:profiles_select_all 策略是 using (true),也就是任何登录用户
-- 直接 supabase.from("profiles").select("*").eq("id", 任意id) 都能拿到
-- 那一行的全部数据——包括 active_session_id、skill_test_hidden_score、
-- skill_test_raw(棋力测试原始棋谱)、telegram_id、stamina/diamonds
-- 这些不该被别人看到的字段。客户端代码目前都很规矩,查别人的时候只
-- select 了 display_name/avatar_url/exp 这几列,但这只是"前端自觉",
-- 绕过前端直接调 API 照样能拿到全部字段,数据库这一层从来没真正管住。
--
-- 修法:
--   1) profiles 本身的 select 策略收紧成"只能看自己那一行"
--   2) 建一个 profiles_public 视图,只暴露 id/display_name/avatar_url/
--      exp/wins/losses/draws/is_guest 这几个本来就打算公开的字段,
--      对所有登录用户开放 —— 排行榜、好友搜索、房间对手信息、邀请
--      通知这些"看别人资料"的场景,改查这个视图而不是查 profiles 本身。
--
-- 视图能绕开第 1 步收紧的 RLS 限制,是因为 Postgres 默认按"视图所有者"
-- 的权限去检查底层表(security_invoker = false,这里显式写出来,不
-- 依赖隐式默认值),而这张表的所有者本身不受自己加的 RLS 策略限制
-- (没有开 FORCE ROW LEVEL SECURITY)。所以视图能看到所有行,但因为
-- 视图定义里只选了这几个安全字段,查询者也只能拿到这几个字段——
-- 这跟之前 profiles 表本身做的"列级 UPDATE 权限收紧"是同一个思路,
-- 只是这次用在 SELECT 上。
-- ============================================================

-- 1) 收紧 profiles 本身的 select 策略:只能看自己
drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_self" on profiles for select using (auth.uid() = id);

-- 2) 建公开只读视图,只暴露这几个字段
create or replace view profiles_public
with (security_invoker = false)
as
select id, display_name, avatar_url, exp, wins, losses, draws, is_guest
from profiles;

grant select on profiles_public to authenticated;

-- 视图不受 RLS 策略约束(RLS 只作用于表),但为了避免以后有人往这个
-- 视图上加更多列却忘了这条注释背后的用意,这里不重复设权限,直接靠
-- "视图定义里只写了安全字段"这一条硬性保证。
