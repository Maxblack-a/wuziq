import { useEffect, useRef, useState, Suspense, lazy } from "react";
import MainMenu from "./components/MainMenu";
import IncomingInviteModal from "./components/IncomingInviteModal";
import IncomingFriendRequestModal from "./components/IncomingFriendRequestModal";
import DailyTrialGateModal from "./components/DailyTrialGateModal";
import { getDisplayStamina } from "./game/dailyTrialEngine";
import {
  supabase, loginWithTelegram, loginAnonymously, getExistingUserId,
  claimSession, getStoredSessionId, clearStoredSessionId,
} from "./lib/supabase";
import { initTelegram, isInTelegram, getInitData, getStartParam, getTelegramUserId } from "./lib/telegram";
import { initPresence } from "./lib/presence";

// 下面这些"页面级"组件全部改成 React.lazy 懒加载——原来全部走静态 import,
// 打出来的主 bundle 518KB(vite build 会警告),但用户进来大概率只用到
// 其中一两个(比如只想下一局人机,压根不会碰联机对战/每日试炼/棋力测试
// 那一整套代码)。这里全部是通过 `screen === "xxx"` 条件渲染切出来的,
// 天然就是"路由"的形状,很适合按需加载,不用 IncomingInviteModal /
// IncomingFriendRequestModal / DailyTrialGateModal 这几个小弹窗那样,
// 它们随时可能跟主菜单一起冒出来,还是保持静态 import。
const PveScreen = lazy(() => import("./components/PveScreen"));
const DailyTrialScreen = lazy(() => import("./components/DailyTrialScreen"));
const MatchmakingScreen = lazy(() => import("./components/MatchmakingScreen"));
const InviteScreen = lazy(() => import("./components/InviteScreen"));
const RoomScreen = lazy(() => import("./components/RoomScreen"));
const OnlineGame = lazy(() => import("./components/OnlineGame"));
const FriendsScreen = lazy(() => import("./components/FriendsScreen"));
const LeaderboardScreen = lazy(() => import("./components/LeaderboardScreen"));
const ProfileScreen = lazy(() => import("./components/ProfileScreen"));
const MatchHistoryScreen = lazy(() => import("./components/MatchHistoryScreen"));
const LinMoIntroScreen = lazy(() => import("./components/LinMoIntroScreen"));
const SkillTestScreen = lazy(() => import("./components/SkillTestScreen"));
const SkillTestResultScreen = lazy(() => import("./components/SkillTestResultScreen"));
const SkillTestEvaluationScreen = lazy(() => import("./components/SkillTestEvaluationScreen"));
const SkillTestReviewScreen = lazy(() => import("./components/SkillTestReviewScreen"));
const WebAuthScreen = lazy(() => import("./components/WebAuthScreen"));

// 主菜单以外这一大片 `screen === "xxx"` 分支已经处在 .app-shell 内部了,
// 不需要再套一层 app-shell 结构,只要给 Suspense 一个居中的 spinner 占位。
function ScreenFallbackInline() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
      <div className="spinner" />
    </div>
  );
}

// ⚠️ 调试用开关:改成 true 之后,不管账号昵称/棋力测试状态是什么,
// 每次登录成功都会强制停在"认识林墨"这个见面场景,方便反复测试效果。
// 正式发布前记得改回 false,不然所有用户每次打开都会被拦在这一页。
const DEBUG_ALWAYS_SHOW_LINMO = false;

export default function App() {
  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("loading"); // loading | nickname | skilltest | skilltest_result | skilltest_evaluation | skilltest_view | menu | pve | daily | matchmaking | invite | room | game | friends | leaderboard | profile | history
  const [skillTestProfile, setSkillTestProfile] = useState(null); // 棋力测试结果(揭晓页要用),测完/看完就不需要再留着
  const [skillTestPriorHistory, setSkillTestPriorHistory] = useState([]); // 这次测试之前的历史记录(倒序),给结果页做"跟上次比/最近怎么样"——
    // 复测功能去掉之后,应用内已经没有任何入口能让一个 status='completed'
    // 的玩家回到这个屏幕,所以这份数据在实践中基本总是空数组(只有
    // "第一次做测试"这一种路径能走到这里,自然没有"上一次"可比)。
    // 留着这套机制不删,是因为它本身没坏、也不是这次要处理的范围。
  // 'onboarding':新用户第一次见面那次触发的测试,结束后要接回登录后原本
  // 该走的路由;'standalone':从应用内其他地方单独发起的测试(见
  // handleStartSkillTestStandalone),结束后应该退回到发起测试之前所在
  // 的页面(靠 goBack),两种模式结束时的路由不一样,所以测试流程本身
  // (SkillTestScreen)不需要关心,靠这个标记来分流。
  const [skillTestMode, setSkillTestMode] = useState("onboarding");
  // 点"每日试炼"但棋风测试还没做完(status 不是 completed)时弹出的
  // 门槛提示,见 navigate() 里的拦截逻辑。
  const [showDailyTrialGate, setShowDailyTrialGate] = useState(false);
  // 见面场景从哪一步开始:'name' 要问名字(Telegram/访客新用户),'invite'
  // 跳过问名字、直接邀请测试(网页版注册账号已经有名字了,或者是老账号
  // 第一次遇到这个新功能)。见 afterLogin 里的判断。
  const [linmoIntroStep, setLinmoIntroStep] = useState("name");
  const [roomId, setRoomId] = useState(null);
  const [prefillRoomCode, setPrefillRoomCode] = useState(null);
  // 对战邀请、好友申请统一进这一个队列,一个个强制弹窗处理——两种通知
  // 都是"必须回应"的事,不用两套并行的状态各管各的。队首这一条决定当前
  // 弹的是哪个弹窗,处理完(同意/拒绝)就出队,轮到下一条。
  // 每一项: { kind: 'invite' | 'friend_request', id, fromName, fromAvatar, room_id?, created_at }
  const [notifQueue, setNotifQueue] = useState([]);
  const [notifBusy, setNotifBusy] = useState(false);

  // 单设备登录:sessionConflict 非空 = 登录流程走到"这个账号在别处有一局
  // 对局正在进行中"这一步,停下来等用户确认要不要继续(继续=判那局负);
  // kickedOut = 我这台设备正在用的时候,账号被别处登录顶替了,弹一个
  // 拦截全部操作的提示,不再是登录流程的一部分,是"用到一半被踢"的场景。
  const [sessionConflict, setSessionConflict] = useState(null); // { roomId }
  const [sessionConflictBusy, setSessionConflictBusy] = useState(false);
  const [kickedOut, setKickedOut] = useState(false);
  const pendingLoginUidRef = useRef(null);

  // 导航历史栈:每次从一个页面"跳去"另一个页面(navigate/handleMatched),
  // 把跳转前那一刻的 { screen, roomId } 压进来。Telegram 原生返回键 /
  // 页面自己的返回逻辑统一走 goBack() 弹出最近这一条,回到"真正带你
  // 进入当前页面的那个页面",而不是不管三七二十一直接回首页。
  // 用 ref 不用 state——这东西不需要参与渲染,只是记录轨迹供 goBack 读取。
  const historyRef = useRef([]);
  // 首页体力/钻石徽章要做"从旧值滚到新值"的动画,但 MainMenu 每次离开
  // 首页再回来都是重新挂载的(没有组件内部状态能记住"上次首页显示的
  // 是多少"),所以离开首页那一刻,把当时的值存这里当"起点"——等回到
  // 首页,MainMenu 拿这个起点跟最新的 profile 值一比,该多少就滚多少。
  const homeBaselineRef = useRef({ stamina: undefined, diamonds: undefined });

  // routeAfterLogin 定义在下面的 useEffect 里(跟 boot 共享一份逻辑),
  // 用 ref 存一份引用,好在"确认昵称"完成之后从组件方法里调用它。
  const routeAfterLoginRef = useRef(null);

  // afterLogin 同样定义在下面的 useEffect 里,用 ref 存一份,好在
  // WebAuthScreen(登录/注册页)登录成功的回调里调用——那个回调是从
  // JSX 里传下去的普通组件方法,不在 useEffect 的闭包里,拿不到里面
  // 定义的函数,只能通过 ref 中转。
  const afterLoginRef = useRef(null);
  // 网页版登录/注册/访客登录成功之后,都要先过一遍"单设备登录"顶替流程,
  // 不能直接跳去 afterLoginRef——那样会跳过"别处有对局正在进行"的确认。
  const establishSessionRef = useRef(null);
  async function handleWebAuthSuccess(uid) {
    if (establishSessionRef.current) await establishSessionRef.current(uid);
  }

  // 登录成功后(不管是网页版账号密码、Telegram 免密、还是访客登录)拿到
  // uid 时统一走这里,先处理"顶替旧设备登录"这一步,再继续原来的收尾
  // 流程(afterLoginRef,写 myId、路由等)。
  async function establishSession(uid) {
    let result;
    try {
      result = await claimSession(false);
    } catch (e) {
      console.error("会话顶替失败", e);
      if (afterLoginRef.current) await afterLoginRef.current(uid);
      return;
    }
    if (result?.has_active_game) {
      pendingLoginUidRef.current = uid;
      setSessionConflict({ roomId: result.room_id });
      return; // 停在确认框,等 handleSessionConflictConfirm / Cancel
    }
    if (afterLoginRef.current) await afterLoginRef.current(uid);
  }

  async function handleSessionConflictConfirm() {
    setSessionConflictBusy(true);
    try {
      await claimSession(true);
      const uid = pendingLoginUidRef.current;
      setSessionConflict(null);
      pendingLoginUidRef.current = null;
      if (afterLoginRef.current) await afterLoginRef.current(uid);
    } finally {
      setSessionConflictBusy(false);
    }
  }

  async function handleSessionConflictCancel() {
    setSessionConflict(null);
    pendingLoginUidRef.current = null;
    clearStoredSessionId();
    await supabase.auth.signOut();
    // 简单粗暴地刷新页面重新走一遍启动流程,不用另外维护一套"取消登录后
    // 该停在哪个界面"的状态机——Telegram 场景刷新后会重新免密登录(那台
    // 设备继续保留原来的对局),网页版会落回登录页。
    window.location.reload();
  }

  // 林墨见面场景第一步"确认昵称"之后:写库,顺手把本地 profile 缓存也
  // 更新一下(不然接下来菜单页头像旁边的名字要等下一次 refreshProfile
  // 才会变)。注意这里不再往下路由——LinMoIntroScreen 会留在同一个场景里
  // 接着问"要不要测一下棋力",路由要等那一步(接受/跳过/测完)才会发生。
  async function handleNicknameConfirmed(name) {
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name, nickname_confirmed: true })
      .eq("id", myId);
    if (error) throw error;
    setProfile((prev) => (prev ? { ...prev, display_name: name, nickname_confirmed: true } : prev));
  }

  // 林墨见面场景第二步:接受邀请,进棋力测试对局(第一次见面这条路,
  // 模式固定是 onboarding)
  function handleSkillTestStart() {
    setSkillTestMode("onboarding");
    setScreen("skilltest");
  }

  // 从应用内某个地方(不是新用户见面那套流程)单独发起棋风测试——目前
  // 两处会用到:"我的"页面里"还没测过"的引导入口、每日试炼门槛弹窗里
  // "去测一测"。都是玩家第一次做这个测试,不是"复测"(复测/重新测这个
  // 功能已经去掉了——棋风测试完成之后 status 会锁定成 completed,应用内
  // 不再有任何入口能回到这个屏幕,所以下面 continueAfterSkillTest /
  // handleSkillTestSkip 里的 priorHistory 比较逻辑,对这次改动之后的
  // 新用户来说其实永远不会有"上一次"可比——这是移除复测的直接后果,
  // 保留 compareToLastLine/recentTrendLine 这两处调用只是不去动它,
  // 不代表还指望它们派上用场)。
  //
  // 调用方自己负责把"发起测试之前所在的页面"压进历史栈(参考
  // navigate() 的写法),这里只管切换模式和屏幕。
  function handleStartSkillTestStandalone() {
    setSkillTestMode("standalone");
    setScreen("skilltest");
  }

  // 棋力测试路由完成之后(测完看完揭晓页 / 跳过 / 中途放弃)统一走这里。
  // onboarding 模式:继续原来登录成功后该走的路由(深链接/断线续局/回首页)。
  // standalone 模式:哪来的回哪去——用 goBack() 退回发起测试之前所在的
  // 页面,不能碰 routeAfterLoginRef,那是专属登录流程的东西。
  async function continueAfterSkillTest() {
    setSkillTestProfile(null);
    if (skillTestMode === "standalone") {
      setSkillTestMode("onboarding");
      goBack();
      return;
    }
    if (routeAfterLoginRef.current) {
      await routeAfterLoginRef.current(myId);
    } else {
      setScreen("menu");
    }
  }

  // 邀请时点"改天吧",或者对局中途点"先不测了":onboarding 模式下当作
  // 跳过处理并继续登录路由;standalone 模式下不写库,直接退回原页面。
  async function handleSkillTestSkip() {
    if (skillTestMode === "standalone") {
      goBack();
      return;
    }
    if (myId) {
      // skill_test_status 现在是 profiles 上的系统字段,客户端不能再直接
      // update 这张表,改走 skip_skill_test() RPC(见 security_hardening_p0.sql)
      supabase.rpc("skip_skill_test")
        .then(({ error }) => { if (error) console.error("记录跳过棋力测试失败", error); });
    }
    await continueAfterSkillTest();
  }

  // 测试对局结束(不管是关卡收集完、撞了步数上限、还是意外分出了胜负):
  // 把六维风格分/隐藏水平分/原始数据写库,再进结果揭晓页——揭晓页看完
  // 点"继续"才会真正往下路由,不在这里直接走。
  async function handleSkillTestFinish(profile, testState, reason, sessionId) {
    let priorHistory = [];
    if (myId) {
      // 写入这次结果之前,先把"这次之前"的历史记录取出来,给结果页做
      // "跟上次比""最近这段时间"这两句用——顺序很重要,如果先插入
      // 这次的记录再查,会把这次自己也查出来,变成"跟自己比"。
      const { data: historyRows, error: historyError } = await supabase
        .from("skill_test_history")
        .select("dims, type, completed_at")
        .eq("profile_id", myId)
        .order("completed_at", { ascending: false })
        .limit(5);
      if (historyError) console.error("读取棋力测试历史失败", historyError);
      priorHistory = (historyRows || []).map((r) => ({ dims: r.dims, type: r.type, completedAt: r.completed_at }));

      const skillTestUpdate = {
        skill_test_status: "completed",
        skill_test_dims: profile.dims,
        skill_test_type: profile.type,
        skill_test_hidden_score: profile.hiddenScore,
        skill_test_confidence: profile.confidence,
        skill_test_raw: {
          moves: testState.moves,
          checkpoints: testState.checkpoints,
          openingSamples: testState.openingSamples,
        },
        skill_test_completed_at: new Date().toISOString(),
      };

      // skill_test_* 都是 profiles 上的系统字段,不能再直接 update 这张表
      // (见 security_hardening_p0.sql:客户端只保留 display_name/avatar_url/
      // nickname_confirmed 三列的写权限)。写 profiles 快照 + 追加历史行,
      // 现在由 submit_skill_test_result() 这一个 RPC 在服务端原子完成。
      const { error } = await supabase.rpc("submit_skill_test_result", {
        p_dims: profile.dims,
        p_type: profile.type,
        p_hidden_score: profile.hiddenScore,
        p_confidence: profile.confidence,
        p_raw: skillTestUpdate.skill_test_raw,
        // sessionId 必填——必须是 SkillTestScreen 挂载时 start_skill_test()
        // 拿到的那个,服务器会校验它属于当前用户、还没提交过、没超时,还会
        // 顺手查一下耗时是否合理(见 supabase/skill_test_session_binding.sql)。
        p_session_id: sessionId,
      });
      if (error) {
        console.error("保存棋力测试结果失败", error);
      } else {
        // 写库成功后立刻同步本地 profile state——不然 navigate("daily") 里
        // 读的还是测试之前缓存的 profile(status 还是 null/pending),onboarding
        // 模式测完之后不会经过任何一处 refreshProfile,会导致测完立刻点
        // "每日试炼"又被门槛弹窗拦一次,误判成"没测过"。
        setProfile((prev) => (prev ? { ...prev, ...skillTestUpdate } : prev));
      }
    }
    setSkillTestProfile(profile);
    setSkillTestPriorHistory(priorHistory);
    setScreen("skilltest_result");
  }

  async function refreshProfile(uid) {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data);
    return data;
  }

  // 查一遍所有还没处理的对战邀请 + 好友申请,按发起时间排好序塞进队列。
  // 只在登录成功后跑一次——实时订阅(下面那个 effect)只能抓到"订阅开始之后
  // 新发生"的事件,订阅开始之前就已经存在、但还没处理的,得靠这次主动查询补上,
  // 不然用户如果是在收到邀请之后才重新打开 App,会永远看不到这条弹窗。
  async function loadPendingNotifications(uid) {
    const [{ data: invites }, { data: requests }] = await Promise.all([
      supabase.from("game_invites")
        .select("id, room_id, created_at, from_id")
        .eq("to_id", uid).eq("status", "pending").order("created_at", { ascending: true }),
      supabase.from("friend_requests")
        .select("id, from_id, created_at")
        .eq("to_id", uid).eq("status", "pending").order("created_at", { ascending: true }),
    ]);
    // 发起人的头像/昵称原来是靠 profiles:from_id(...) 这种隐式外键 join
    // 一起查出来的,但 profiles 表本身的 select 权限现在收紧到只能看自己
    // 那一行(见 supabase/profiles_public_view.sql),嵌入式 join 本质上
    // 还是对 profiles 表发起一次查询,会被同一条 RLS 拦住。改成先查两张
    // 通知表拿到 from_id,再对 profiles_public 这个安全视图批量查一次,
    // 在前端把结果拼回去。
    const fromIds = [...new Set([...(invites || []), ...(requests || [])].map((r) => r.from_id))];
    let senderMap = {};
    if (fromIds.length) {
      const { data: senders } = await supabase
        .from("profiles_public")
        .select("id, display_name, avatar_url")
        .in("id", fromIds);
      senderMap = Object.fromEntries((senders || []).map((p) => [p.id, p]));
    }
    const items = [
      ...(invites || []).map((i) => ({
        kind: "invite", id: i.id, room_id: i.room_id,
        fromName: senderMap[i.from_id]?.display_name, fromAvatar: senderMap[i.from_id]?.avatar_url, created_at: i.created_at,
      })),
      ...(requests || []).map((r) => ({
        kind: "friend_request", id: r.id,
        fromName: senderMap[r.from_id]?.display_name, fromAvatar: senderMap[r.from_id]?.avatar_url, created_at: r.created_at,
      })),
    ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (items.length) setNotifQueue((prev) => [...prev, ...items]);
  }

  useEffect(() => {
    initTelegram();

    // 登录成功(不管是 Telegram 免密登录、网页版账号密码登录/注册、还是
    // 访客登录)之后共用的收尾逻辑:写 myId、上线报到、补历史通知、
    // 按昵称确认状态决定去"确认昵称"页还是直接往下路由。单独拆出来,
    // 好在 WebAuthScreen 登录成功的回调里复用同一份,不用抄一遍。
    async function afterLogin(uid, preloadedProfile) {
      const cachedProfile = preloadedProfile || await refreshProfile(uid);

      // 单设备登录:如果这个账号已经确立过 session(active_session_id 不为
      // 空),而我本地存的最后一次 session_id 对不上,说明在我不知情的
      // 时候,别的设备登录顶替了我——不管我是"缓存态直接重开 App"还是
      // 走到这里之前的哪条路径,统一在这里兜底拦一下,不往下继续路由。
      // (刚走完 establishSession/claimSession 的全新登录不会触发这条:
      // 那条路径在调用 afterLogin 之前,本地存的 session_id 已经跟服务端
      // 同步过了。)
      if (cachedProfile?.active_session_id && getStoredSessionId() !== cachedProfile.active_session_id) {
        setKickedOut(true);
        setScreen("menu"); // 具体停在哪个 screen 不重要,kickedOut 的全屏提示会盖住一切
        return;
      }

      setMyId(uid);
      initPresence(uid); // 往"在线用户"这个全局频道报到,好友列表能看到谁在线
      loadPendingNotifications(uid); // 补一次:上次关闭 App 期间收到的邀请/申请,实时订阅是抓不到的,得主动查一遍

      // 第一次进这个游戏、且昵称还没走过确认这一步:停在"认识林墨"场景,
      // 先问名字,名字确认完在同一个场景里接着问要不要测棋力
      // (LinMoIntroScreen 内部 step 从 'name' 切到 'invite',不用再回这里
      // 重新判断)。往下走深链接/断线续局那套路由逻辑要等这一步走完
      // (continueAfterSkillTest 会接着补上)。
      //
      // 网页版用户名密码注册的账号,注册那一步已经手动填过昵称了
      // (password-auth 云函数直接把 nickname_confirmed 标成 true),不会
      // 走到这个"认识林墨"场景,也就不会自动被邀请测棋力——这是有意
      // 的:见下面的说明。
      if (DEBUG_ALWAYS_SHOW_LINMO) {
        setLinmoIntroStep("name");
        setScreen("nickname");
        return;
      }
      if (!cachedProfile?.nickname_confirmed) {
        setLinmoIntroStep("name");
        setScreen("nickname");
        return;
      }
      // 原来这里还有一条 `skill_test_status === "pending"` 就自动弹邀请的
      // 分支,已经去掉——那条判断没法区分"网页版用户第一次注册,昵称在
      // 注册时就写好了,所以走不到上面 nickname_confirmed 那条"和
      // "老账号,这个字段是后加的、用 default 'pending' 回填的,压根不是
      // 第一次登录,只是历史原因状态还停在 pending"这两种情况——凡是
      // 状态没推进过的账号,不管是不是老用户,每次登录都会被自动拉去
      // 问一遍,体验上很打扰。现在自动弹出只保留给上面这条真正意义上的
      // "第一次登录"(从没确认过昵称);其余情况(网页版首次注册、老账号
      // 状态停在 pending 或 skipped)统一靠"每日试炼"入口那道门槛
      // (navigate() 里 skill_test_status !== "completed" 的判断)去发现
      // 并引导测试,不需要登录就强推。
      await routeAfterLogin(uid);
    }

    async function boot() {
      try {
        // 先看有没有现成的登录态,有就直接用,不用每次重开都重新走一遍完整流程。
        // 但要核对一下:这个缓存的账号,是不是真的对应当前打开 App 的这个 Telegram 用户——
        // 同一设备如果切换过 Telegram 账号,不能盲目沿用上一个人的登录态。
        let uid = await getExistingUserId();
        // 免密登录这条路径下面已经查过一次账号资料了(核对 Telegram 账号有没有换过),
        // 查到的结果顺手存下来传给 afterLogin,不用它再重复查一遍同样的数据——
        // 之前这里漏了这层复用,导致每次用 Telegram Mini App 免密打开都要多等
        // 一轮网络请求,这也是"每次打开都很慢"最主要的原因。
        let preloadedProfile = null;
        if (uid && isInTelegram) {
          const cachedProfile = await refreshProfile(uid);
          preloadedProfile = cachedProfile;
          const currentTgId = getTelegramUserId();
          if (currentTgId && cachedProfile?.telegram_id && String(cachedProfile.telegram_id) !== String(currentTgId)) {
            uid = null; // 对不上,丢弃缓存,走下面的完整登录
            preloadedProfile = null;
          }
        }
        if (!uid) {
          if (isInTelegram) {
            uid = await loginWithTelegram(getInitData());
            // Telegram 免密登录属于"全新登录",要走单设备顶替这一套流程
            // (可能弹出"别处有对局正在进行"确认框),不能直接跳去 afterLogin。
            await establishSession(uid);
            return;
          } else {
            // 网页版且这台设备没有任何登录态:停在登录/注册页,等用户
            // 输入用户名密码,或者选择访客体验——不再像以前那样不问
            // 青红皂白直接自动建一个匿名账号。
            setScreen("auth");
            return;
          }
        }
        await afterLogin(uid, preloadedProfile);
      } catch (e) {
        console.error("登录失败", e);
        setScreen("menu");
      }
    }

    // 深链接参数、断线续局这些"登录成功之后该去哪个页面"的判断逻辑,
    // 单独拆出来——昵称确认完之后也要跑一遍同样的路由,不想复制一份。
    async function routeAfterLogin(uid) {
      // 深链接参数:room_邀请码,用于加入对局。这个必须放在"自动续局"检查
      // 之前——用户点了一条明确的邀请链接进来,这是当下最强的意图,不能被
      // "你还有一局没下完"这种被动逻辑悄悄吞掉、带去了别的地方,那样点链接
      // 等于白点。
      // (原来这里还有一个 friend_好友码 分支,好友码那套设计已经去掉了,
      // 加好友改成了在"好友"页/房间邀请面板里搜索昵称、发申请)
      const param = getStartParam();
      if (param?.startsWith("room_")) {
        setPrefillRoomCode(param.slice(5));
        setScreen("invite");
        return;
      }

      // 没有明确的深链接意图时,才去查一下是不是有一局还没下完的对局,或者
      // 一个自己创建、还在等好友加入的邀请房间——有的话直接带回去,而不是丢在大厅。
      // 房间号本来就只活在内存里,刷新/重开就丢了,得靠这个查询找回来。
      //
      // 用单次 .or() 把整个嵌套条件写清楚,而不是链式调用两次 .or()——
      // 后者依赖的是"多次 .or() 之间用 AND 拼起来"这种没有正式文档保证的行为,
      // 不如显式嵌套可靠。
      const { data: activeRoom } = await supabase
        .from("rooms")
        .select("id, status")
        .or(
          `and(status.in.(lobby,playing),or(player1_id.eq.${uid},player2_id.eq.${uid})),` +
          `and(status.eq.waiting,player1_id.eq.${uid})`
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeRoom) {
        setRoomId(activeRoom.id);
        // playing 才是真正在下棋,直接进对局页;waiting/lobby 都还没正式
        // 开局(可能还在等对手、也可能双方都到齐了但没人点开始),回房间页
        setScreen(activeRoom.status === "playing" ? "game" : "room");
      } else {
        setScreen("menu");
      }
    }

    boot();
    // routeAfterLogin / afterLogin 挂到 ref 上,分别给"确认昵称"完成之后、
    // 网页版登录注册成功之后复用同一份逻辑。
    routeAfterLoginRef.current = routeAfterLogin;
    afterLoginRef.current = afterLogin;
    establishSessionRef.current = establishSession;
  }, []);

  // 真正回首页:清空整个导航历史栈,不管之前跳了多少层,这是唯一
  // "确定要回到最外层"的出口(比如深链接场景下历史栈本来就是空的、
  // 或者一局棋刚打完/中途认输离开——这两种都没有一个"回去还有意义"
  // 的上一页,回首页才是正确的落点)。
  function goMenu() {
    historyRef.current = [];
    setScreen("menu");
    setRoomId(null);
    setPrefillRoomCode(null);
    if (myId) refreshProfile(myId);
  }

  // 从一个页面主动跳去另一个页面时调这个,而不是直接 setScreen——
  // 会先把"跳转前我在哪"记一笔到历史栈里,goBack 才有地方可退。
  //
  // "daily" 这个目标单独拦一道:每日试炼现在要求必须先做完棋风测试
  // (status === 'completed')才能进,没做完(null / pending / skipped
  // 都算)就不放行,弹一个门槛提示,让玩家自己选"去测一测"还是
  // "先不测了"。拦在这个统一入口而不是 MainMenu 按钮的 onClick 里,
  // 是因为 navigate("daily") 不一定只会从主菜单那一个按钮触发——
  // 以后不管哪个页面想跳每日试炼,都会经过这一道检查,不用每个调用方
  // 各自记得判断一遍。
  function navigate(nextScreen) {
    if (nextScreen === "daily" && profile?.skill_test_status !== "completed") {
      setShowDailyTrialGate(true);
      return;
    }
    if (screen === "menu") {
      homeBaselineRef.current = {
        stamina: getDisplayStamina(profile?.stamina, profile?.stamina_date),
        diamonds: profile?.diamonds,
      };
    }
    historyRef.current.push({ screen, roomId });
    setScreen(nextScreen);
  }

  // 门槛弹窗里点"去测一测":复用 handleStartSkillTestStandalone(standalone
  // 模式测完/中途放弃时都是简单地 goBack() 退回来处的页面,不会去碰
  // routeAfterLoginRef,也不会因为"放弃"就强制把状态写成 skipped——
  // 这些语义正好是"半路想起来去测一下"该有的行为)。手动做一次
  // navigate() 本来会做的历史入栈,因为这里没有经过 navigate()。
  function handleDailyTrialGateStartTest() {
    setShowDailyTrialGate(false);
    historyRef.current.push({ screen, roomId });
    handleStartSkillTestStandalone();
  }

  // 返回上一页:弹出历史栈最近的一条,回到"进入当前页面之前所在的
  // 那个页面",而不是当前页面自己内部的某个中间状态。栈空了(比如
  // 深链接直接进来、历史已经在 goMenu 里被清空过)就落回首页兜底。
  function goBack() {
    const last = historyRef.current.pop();
    if (!last) {
      goMenu();
      return;
    }
    setScreen(last.screen);
    setRoomId(last.roomId ?? null);
    if (last.screen === "menu" && myId) refreshProfile(myId);
  }

  // 之前这里不管三七二十一都直接进 "game"(真实对局页)。现在一个房间
  // 号背后可能是两种情况:随机匹配直接配对成功的(状态已经是 playing,
  // 双方都准备好了,直接开打)、或者好友邀请接受/扫码加入的(状态是
  // lobby,人到齐了但还没人点开始)——查一下状态,分别送去对应的页面。
  //
  // 这个跳转也可能是从别的页面被动触发的(比如收到好友对战邀请、点了
  // 接受),所以同样先把"跳转前在哪"记进历史栈——房间/对局页面自己
  // 退出时会走 goBack 或 goMenu,不会真的依赖这条记录时才需要小心处理,
  // 记了也无害。
  async function handleMatched(id) {
    historyRef.current.push({ screen, roomId });
    setRoomId(id);
    const { data } = await supabase.from("rooms").select("status").eq("id", id).single();
    setScreen(data?.status === "playing" ? "game" : "room");
  }

  // 接受/拒绝好友对战邀请,都可以顺手带一句话(选填)。
  // 好友申请没有留言这一说,同意/拒绝各自一个按钮就够了。
  // 两组处理完都是"出队":把队首这条挪走,轮到下一条(如果还有的话)自动弹出来。
  async function handleAcceptInvite(message) {
    const current = notifQueue[0];
    if (!current || current.kind !== "invite") return;
    setNotifBusy(true);
    const { data: newRoomId, error } = await supabase.rpc("accept_game_invite", {
      p_invite_id: current.id,
      p_message: message,
    });
    setNotifBusy(false);
    setNotifQueue((prev) => prev.slice(1));
    if (!error && newRoomId) {
      handleMatched(newRoomId);
    }
  }

  async function handleDeclineInvite(message) {
    const current = notifQueue[0];
    if (!current || current.kind !== "invite") return;
    setNotifBusy(true);
    await supabase.from("game_invites")
      .update({ status: "declined", response_message: message })
      .eq("id", current.id);
    setNotifBusy(false);
    setNotifQueue((prev) => prev.slice(1));
  }

  async function handleRespondFriendRequest(accept) {
    const current = notifQueue[0];
    if (!current || current.kind !== "friend_request") return;
    setNotifBusy(true);
    await supabase.rpc("respond_friend_request", { p_request_id: current.id, p_accept: accept });
    setNotifBusy(false);
    setNotifQueue((prev) => prev.slice(1));
  }

  // 单设备登录:实时盯着自己这一行 profiles 的 active_session_id。用到
  // 一半(不是重开 App 那种场景,是正开着的时候)如果别的设备登录顶替了
  // 我,这里几乎实时收到通知,弹出全屏拦截提示——不依赖用户之后凑巧
  // 触发一次刷新/重开才发现自己已经被踢了。
  useEffect(() => {
    if (!myId) return;
    const sessionChannel = supabase
      .channel(`session-guard-${myId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${myId}` },
        (payload) => {
          const latest = payload.new?.active_session_id;
          if (latest && getStoredSessionId() !== latest) {
            setKickedOut(true);
          }
        }
      ).subscribe();
    return () => supabase.removeChannel(sessionChannel);
  }, [myId]);

  // 全局监听发给我的对战邀请 + 好友申请:不管当前停在哪个页面,只要有新的
  // 就推进队列弹窗,不需要专门跑到"好友"页面才能看到。只在拿到登录身份
  // 之后才订阅;订阅开始之前已经存在的,靠上面 loadPendingNotifications 补。
  useEffect(() => {
    if (!myId) return;
    const inviteChannel = supabase
      .channel(`global-invites-${myId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "game_invites", filter: `to_id=eq.${myId}` },
        async (payload) => {
          const inv = payload.new;
          const { data: fromProfile } = await supabase
            .from("profiles_public").select("display_name, avatar_url").eq("id", inv.from_id).single();
          setNotifQueue((prev) => [...prev, {
            kind: "invite", id: inv.id, room_id: inv.room_id,
            fromName: fromProfile?.display_name, fromAvatar: fromProfile?.avatar_url,
          }]);
        }
      ).subscribe();

    const requestChannel = supabase
      .channel(`global-friend-requests-${myId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_requests", filter: `to_id=eq.${myId}` },
        async (payload) => {
          const req = payload.new;
          const { data: fromProfile } = await supabase
            .from("profiles_public").select("display_name, avatar_url").eq("id", req.from_id).single();
          setNotifQueue((prev) => [...prev, {
            kind: "friend_request", id: req.id,
            fromName: fromProfile?.display_name, fromAvatar: fromProfile?.avatar_url,
          }]);
        }
      ).subscribe();

    return () => {
      supabase.removeChannel(inviteChannel);
      supabase.removeChannel(requestChannel);
    };
  }, [myId]);

  if (kickedOut) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <h2 className="text-heading">账号已在其他设备登录</h2>
        <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>
          你的账号刚刚在别的地方登录了,这台设备已经退出。如果不是你本人操作,建议尽快检查账号安全。
        </p>
        <button
          className="btn-primary"
          style={{ marginTop: "var(--space-6)" }}
          onClick={async () => {
            clearStoredSessionId();
            await supabase.auth.signOut();
            window.location.reload();
          }}
        >
          好的
        </button>
      </div>
    );
  }

  if (sessionConflict) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <h2 className="text-heading">你有一局对局正在其他设备进行中</h2>
        <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>
          继续在这台设备登录,会让那一局直接判负,并且原设备会被登出。确定要继续吗?
        </p>
        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", width: "100%", maxWidth: 320 }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={handleSessionConflictCancel} disabled={sessionConflictBusy}>
            取消
          </button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleSessionConflictConfirm} disabled={sessionConflictBusy}>
            {sessionConflictBusy ? "处理中…" : "继续登录"}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (screen === "auth") {
    return (
      <div className="app-shell">
        <Suspense fallback={<div className="spinner" />}>
          <WebAuthScreen onSuccess={handleWebAuthSuccess} />
        </Suspense>
      </div>
    );
  }

  if (screen === "nickname") {
    return (
      <div className="app-shell">
        <Suspense fallback={<div className="spinner" />}>
          <LinMoIntroScreen
            initialName={profile?.display_name || ""}
            initialStep={linmoIntroStep}
            exp={profile?.exp}
            avatarUrl={profile?.avatar_url}
            onNameConfirm={handleNicknameConfirmed}
            onStartTest={handleSkillTestStart}
            onSkipTest={handleSkillTestSkip}
          />
        </Suspense>
      </div>
    );
  }

  if (screen === "skilltest") {
    return (
      <div className="app-shell">
        <Suspense fallback={<div className="spinner" />}>
          <SkillTestScreen onFinish={handleSkillTestFinish} onAbort={handleSkillTestSkip} />
        </Suspense>
      </div>
    );
  }

  if (screen === "skilltest_result" && skillTestProfile) {
    return (
      <div className="app-shell">
        <Suspense fallback={<div className="spinner" />}>
          <SkillTestResultScreen
            profile={skillTestProfile}
            onContinue={() => setScreen("skilltest_evaluation")}
          />
        </Suspense>
      </div>
    );
  }

  if (screen === "skilltest_evaluation" && skillTestProfile) {
    return (
      <div className="app-shell">
        <Suspense fallback={<div className="spinner" />}>
          <SkillTestEvaluationScreen
            profile={skillTestProfile}
            priorHistory={skillTestPriorHistory}
            onContinue={continueAfterSkillTest}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={`app-shell${screen === "menu" ? " app-shell-menu" : ""}`}>
      {screen === "menu" && (
        <MainMenu
          onSelect={navigate}
          playerName={profile?.display_name}
          exp={profile?.exp}
          avatarUrl={profile?.avatar_url}
          stamina={profile?.stamina}
          staminaDate={profile?.stamina_date}
          diamonds={profile?.diamonds}
          staminaFrom={homeBaselineRef.current.stamina}
          diamondsFrom={homeBaselineRef.current.diamonds}
        />
      )}
      {screen === "pve" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <PveScreen onExit={goBack} onExitHome={goMenu} />
        </Suspense>
      )}
      {screen === "daily" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <DailyTrialScreen onExit={goBack} onExitHome={goMenu} avatarUrl={profile?.avatar_url} exp={profile?.exp} />
        </Suspense>
      )}
      {screen === "matchmaking" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <MatchmakingScreen
            myId={myId}
            onMatched={handleMatched}
            onExit={goBack}
            onFallbackToPve={() => navigate("pve")}
          />
        </Suspense>
      )}
      {screen === "invite" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <InviteScreen myId={myId} prefillCode={prefillRoomCode} onMatched={handleMatched} onExit={goBack} />
        </Suspense>
      )}
      {screen === "room" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <RoomScreen
            myId={myId}
            roomId={roomId}
            playerName={profile?.display_name}
            avatarUrl={profile?.avatar_url}
            exp={profile?.exp}
            onMatched={handleMatched}
            onExit={goBack}
            onRandomMatch={() => navigate("matchmaking")}
          />
        </Suspense>
      )}
      {screen === "friends" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <FriendsScreen myId={myId} onMatched={handleMatched} onExit={goBack} />
        </Suspense>
      )}
      {screen === "leaderboard" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <LeaderboardScreen myId={myId} onExit={goBack} />
        </Suspense>
      )}
      {screen === "profile" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <ProfileScreen myId={myId} onExit={goBack} onNavigate={navigate} />
        </Suspense>
      )}
      {screen === "skilltest_view" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <SkillTestReviewScreen
            myId={myId}
            onExit={goBack}
            onStartTest={() => { historyRef.current.push({ screen, roomId }); handleStartSkillTestStandalone(); }}
          />
        </Suspense>
      )}
      {screen === "history" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <MatchHistoryScreen myId={myId} onExit={goBack} />
        </Suspense>
      )}
      {screen === "game" && (
        <Suspense fallback={<ScreenFallbackInline />}>
          <OnlineGame roomId={roomId} myId={myId} avatarUrl={profile?.avatar_url} onExit={goMenu} onMatched={handleMatched} />
        </Suspense>
      )}

      {notifQueue[0]?.kind === "invite" && (
        <IncomingInviteModal
          invite={notifQueue[0]}
          busy={notifBusy}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      )}
      {notifQueue[0]?.kind === "friend_request" && (
        <IncomingFriendRequestModal
          request={notifQueue[0]}
          busy={notifBusy}
          onAccept={() => handleRespondFriendRequest(true)}
          onDecline={() => handleRespondFriendRequest(false)}
        />
      )}
      {showDailyTrialGate && (
        <DailyTrialGateModal
          onStartTest={handleDailyTrialGateStartTest}
          onClose={() => setShowDailyTrialGate(false)}
        />
      )}
    </div>
  );
}
