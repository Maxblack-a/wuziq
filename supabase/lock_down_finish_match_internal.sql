-- ============================================================
-- P0 补丁:_finish_match_internal 目前对 PUBLIC 完全暴露
--
-- 这个函数本意是"只给 finish_match / make_move / claim_session /
-- check_timeouts 这些已经做过权限校验的入口内部调用"的,函数名前缀
-- 下划线只是命名约定,PostgreSQL 不会因为这个就默认收紧权限——
-- 函数一旦 create,默认所有角色(含 anon、authenticated)都能直接
-- execute,除非显式 revoke。
--
-- 而这个函数体内部本身没有任何权限校验(不检查 auth.uid() 是不是
-- 这局的玩家,甚至不检查这个房间跟当前登录用户有没有关系),这是
-- 故意的——因为 check_timeouts(系统定时任务,没有 auth.uid() 上下文)
-- 和 claim_session(新设备顶替旧设备时强制判负旧对局)都需要绕开
-- "必须是参与者本人在调用"这条限制去调用它。
--
-- 但这意味着现在任何登录用户都可以直接:
--   supabase.rpc('_finish_match_internal', {
--     p_room_id: '任意房间id(甚至不用是自己在玩的那局)',
--     p_winner: 1, p_reason: 'normal'
--   })
-- 完全绕开 finish_match / make_move 里刚加固的所有校验,任意篡改
-- 任何一局的胜负和双方 EXP/wins/losses/draws。
--
-- 修法:把这个函数从 PUBLIC 的默认执行权限里收回来,只留给
-- security definer 的上层入口(finish_match/make_move/claim_session/
-- check_timeouts 本身也是 security definer 运行,不受这条 revoke
-- 影响,内部互相调用不需要额外的 execute 权限)。
-- ============================================================

revoke execute on function _finish_match_internal(uuid, int, text) from public;
revoke execute on function _finish_match_internal(uuid, int, text) from anon;
revoke execute on function _finish_match_internal(uuid, int, text) from authenticated;

-- 顺手把另一个下划线开头的内部函数也收一下,虽然它本身逻辑上没有
-- 可利用的风险(只会读/校验当前登录用户自己的 session,不会替别人
-- 写任何东西,直接调用它拿不到任何好处),但既然要按"内部函数一律
-- 显式收紧"这条规矩来,不留特例,以后新增内部函数时也不用每次都
-- 重新判断"这个到底要不要收"。
revoke execute on function _validate_session(uuid) from public;
revoke execute on function _validate_session(uuid) from anon;
revoke execute on function _validate_session(uuid) from authenticated;
