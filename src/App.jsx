import { useEffect, useRef, useState } from "react";
import MainMenu from "./components/MainMenu";
import PveScreen from "./components/PveScreen";
import MatchmakingScreen from "./components/MatchmakingScreen";
import InviteScreen from "./components/InviteScreen";
import RoomScreen from "./components/RoomScreen";
import IncomingInviteModal from "./components/IncomingInviteModal";
import IncomingFriendRequestModal from "./components/IncomingFriendRequestModal";
import OnlineGame from "./components/OnlineGame";
import FriendsScreen from "./components/FriendsScreen";
import LeaderboardScreen from "./components/LeaderboardScreen";
import ProfileScreen from "./components/ProfileScreen";
import MatchHistoryScreen from "./components/MatchHistoryScreen";
import NicknameSetupScreen from "./components/NicknameSetupScreen";
import WebAuthScreen from "./components/WebAuthScreen";
import {
  supabase, loginWithTelegram, loginAnonymously, getExistingUserId,
  claimSession, getStoredSessionId, clearStoredSessionId,
} from "./lib/supabase";
import { initTelegram, isInTelegram, getInitData, getStartParam, getTelegramUserId } from "./lib/telegram";
import { initPresence } from "./lib/presence";

export default function App() {
  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("loading"); // loading | nickname | menu | pve | matchmaking | invite | room | game | friends | leaderboard | profile | history
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

  // "确认昵称"页点了确认之后:写库,顺手把本地 profile 缓存也更新一下
  // (不然接下来菜单页头像旁边的名字要等下一次 refreshProfile 才会变),
  // 再接上原来登录成功后该走的路由(深链接/断线续局/回首页)。
  async function handleNicknameConfirmed(name) {
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name, nickname_confirmed: true })
      .eq("id", myId);
    if (error) throw error;
    setProfile((prev) => (prev ? { ...prev, display_name: name, nickname_confirmed: true } : prev));
    if (routeAfterLoginRef.current) {
      await routeAfterLoginRef.current(myId);
    } else {
      setScreen("menu");
    }
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
        .select("id, room_id, created_at, profiles:from_id(display_name, avatar_url)")
        .eq("to_id", uid).eq("status", "pending").order("created_at", { ascending: true }),
      supabase.from("friend_requests")
        .select("id, from_id, created_at, profiles:from_id(display_name, avatar_url)")
        .eq("to_id", uid).eq("status", "pending").order("created_at", { ascending: true }),
    ]);
    const items = [
      ...(invites || []).map((i) => ({
        kind: "invite", id: i.id, room_id: i.room_id,
        fromName: i.profiles?.display_name, fromAvatar: i.profiles?.avatar_url, created_at: i.created_at,
      })),
      ...(requests || []).map((r) => ({
        kind: "friend_request", id: r.id,
        fromName: r.profiles?.display_name, fromAvatar: r.profiles?.avatar_url, created_at: r.created_at,
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
    async function afterLogin(uid) {
      const cachedProfile = await refreshProfile(uid);

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

      // 第一次进这个游戏(或者昵称还没走过确认这一步的老账号):停在
      // "确认昵称"页,不往下走深链接/断线续局那套路由逻辑——用户点了
      // 确认之后,handleNicknameConfirmed 会接着把 routeAfterLogin 补上。
      // (网页版用户名密码注册的账号,注册那一步已经手动填过昵称,
      // nickname_confirmed 直接是 true,不会停在这一页。)
      if (!cachedProfile?.nickname_confirmed) {
        setScreen("nickname");
        return;
      }
      await routeAfterLogin(uid);
    }

    async function boot() {
      try {
        // 先看有没有现成的登录态,有就直接用,不用每次重开都重新走一遍完整流程。
        // 但要核对一下:这个缓存的账号,是不是真的对应当前打开 App 的这个 Telegram 用户——
        // 同一设备如果切换过 Telegram 账号,不能盲目沿用上一个人的登录态。
        let uid = await getExistingUserId();
        if (uid && isInTelegram) {
          const cachedProfile = await refreshProfile(uid);
          const currentTgId = getTelegramUserId();
          if (currentTgId && cachedProfile?.telegram_id && String(cachedProfile.telegram_id) !== String(currentTgId)) {
            uid = null; // 对不上,丢弃缓存,走下面的完整登录
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
        await afterLogin(uid);
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
  function navigate(nextScreen) {
    historyRef.current.push({ screen, roomId });
    setScreen(nextScreen);
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
            .from("profiles").select("display_name, avatar_url").eq("id", inv.from_id).single();
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
            .from("profiles").select("display_name, avatar_url").eq("id", req.from_id).single();
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
        <WebAuthScreen onSuccess={handleWebAuthSuccess} />
      </div>
    );
  }

  if (screen === "nickname") {
    return (
      <div className="app-shell">
        <NicknameSetupScreen
          initialName={profile?.display_name || ""}
          avatarUrl={profile?.avatar_url}
          onConfirm={handleNicknameConfirmed}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell${screen === "menu" ? " app-shell-menu" : ""}`}>
      {screen === "menu" && (
        <MainMenu onSelect={navigate} playerName={profile?.display_name} exp={profile?.exp} avatarUrl={profile?.avatar_url} />
      )}
      {screen === "pve" && <PveScreen onExit={goBack} onExitHome={goMenu} />}
      {screen === "matchmaking" && (
        <MatchmakingScreen
          myId={myId}
          onMatched={handleMatched}
          onExit={goBack}
          onFallbackToPve={() => navigate("pve")}
        />
      )}
      {screen === "invite" && (
        <InviteScreen myId={myId} prefillCode={prefillRoomCode} onMatched={handleMatched} onExit={goBack} />
      )}
      {screen === "room" && (
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
      )}
      {screen === "friends" && (
        <FriendsScreen myId={myId} onMatched={handleMatched} onExit={goBack} />
      )}
      {screen === "leaderboard" && <LeaderboardScreen myId={myId} onExit={goBack} />}
      {screen === "profile" && <ProfileScreen myId={myId} onExit={goBack} onNavigate={navigate} />}
      {screen === "history" && <MatchHistoryScreen myId={myId} onExit={goBack} />}
      {screen === "game" && <OnlineGame roomId={roomId} myId={myId} onExit={goMenu} onMatched={handleMatched} />}

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
    </div>
  );
}
