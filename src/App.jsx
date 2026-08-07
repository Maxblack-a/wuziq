import { useEffect, useState } from "react";
import MainMenu from "./components/MainMenu";
import PveScreen from "./components/PveScreen";
import MatchmakingScreen from "./components/MatchmakingScreen";
import InviteScreen from "./components/InviteScreen";
import RoomScreen from "./components/RoomScreen";
import IncomingInviteModal from "./components/IncomingInviteModal";
import OnlineGame from "./components/OnlineGame";
import FriendsScreen from "./components/FriendsScreen";
import LeaderboardScreen from "./components/LeaderboardScreen";
import ProfileScreen from "./components/ProfileScreen";
import { supabase, loginWithTelegram, loginAnonymously, getExistingUserId } from "./lib/supabase";
import { initTelegram, isInTelegram, getInitData, getStartParam, getTelegramUserId } from "./lib/telegram";
import { initPresence } from "./lib/presence";

export default function App() {
  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("loading"); // loading | menu | pve | matchmaking | invite | room | game | friends | leaderboard | profile
  const [roomId, setRoomId] = useState(null);
  const [prefillRoomCode, setPrefillRoomCode] = useState(null);
  const [friendAddMsg, setFriendAddMsg] = useState(null);
  const [incomingInvite, setIncomingInvite] = useState(null); // { id, room_id, fromName, fromAvatar }
  const [inviteBusy, setInviteBusy] = useState(false);

  async function refreshProfile(uid) {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data);
    return data;
  }

  useEffect(() => {
    initTelegram();

    async function boot() {
      try {
        // 先看有没有现成的登录态,有就直接用,不用每次重开都重新走一遍完整流程。
        // 但要核对一下:这个缓存的账号,是不是真的对应当前打开 App 的这个 Telegram 用户——
        // 同一设备如果切换过 Telegram 账号,不能盲目沿用上一个人的登录态。
        let uid = await getExistingUserId();
        let cachedProfile = null;
        if (uid) {
          cachedProfile = await refreshProfile(uid);
          if (isInTelegram) {
            const currentTgId = getTelegramUserId();
            if (currentTgId && cachedProfile?.telegram_id && String(cachedProfile.telegram_id) !== String(currentTgId)) {
              uid = null; // 对不上,丢弃缓存,走下面的完整登录
            }
          }
        }
        if (!uid) {
          if (isInTelegram) {
            uid = await loginWithTelegram(getInitData());
          } else {
            uid = await loginAnonymously("模拟玩家");
          }
          await refreshProfile(uid);
        }
        setMyId(uid);
        initPresence(uid); // 往"在线用户"这个全局频道报到,好友列表能看到谁在线

        // 深链接参数分两种前缀:room_邀请码 用于加入对局,friend_好友码 用于加好友。
        // 这个必须放在"自动续局"检查之前——用户点了一条明确的邀请/好友链接进来,
        // 这是当下最强的意图,不能被"你还有一局没下完"这种被动逻辑悄悄吞掉、
        // 带去了别的地方,那样点链接等于白点。
        const param = getStartParam();
        if (param?.startsWith("room_")) {
          setPrefillRoomCode(param.slice(5));
          setScreen("invite");
          return;
        }
        if (param?.startsWith("friend_")) {
          const code = param.slice(7);
          const { data } = await supabase.rpc("add_friend_by_code", { my_id: uid, target_code: code });
          setFriendAddMsg(data?.error ? data.error : `已添加 ${data?.display_name || "好友"}`);
          setScreen("menu");
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
      } catch (e) {
        console.error("登录失败", e);
        setScreen("menu");
      }
    }
    boot();
  }, []);

  function goMenu() {
    setScreen("menu");
    setRoomId(null);
    setPrefillRoomCode(null);
    if (myId) refreshProfile(myId);
  }

  // 之前这里不管三七二十一都直接进 "game"(真实对局页)。现在一个房间
  // 号背后可能是两种情况:随机匹配直接配对成功的(状态已经是 playing,
  // 双方都准备好了,直接开打)、或者好友邀请接受/扫码加入的(状态是
  // lobby,人到齐了但还没人点开始)——查一下状态,分别送去对应的页面。
  async function handleMatched(id) {
    setRoomId(id);
    const { data } = await supabase.from("rooms").select("status").eq("id", id).single();
    setScreen(data?.status === "playing" ? "game" : "room");
  }

  // 接受/拒绝好友对战邀请,都可以顺手带一句话(选填)。这两个函数挂在
  // App 顶层是因为邀请弹窗本身也是全局的,跟当前具体在哪个 screen 无关。
  async function handleAcceptInvite(message) {
    if (!incomingInvite) return;
    setInviteBusy(true);
    const { data: newRoomId, error } = await supabase.rpc("accept_game_invite", {
      p_invite_id: incomingInvite.id,
      p_message: message,
    });
    setInviteBusy(false);
    setIncomingInvite(null);
    if (!error && newRoomId) {
      handleMatched(newRoomId);
    }
  }

  async function handleDeclineInvite(message) {
    if (!incomingInvite) return;
    setInviteBusy(true);
    await supabase.from("game_invites")
      .update({ status: "declined", response_message: message })
      .eq("id", incomingInvite.id);
    setInviteBusy(false);
    setIncomingInvite(null);
  }

  // 全局监听发给我的对战邀请:不管当前停在哪个页面,只要有好友邀请就弹窗,
  // 不需要专门跑到"好友"页面才能看到。只在拿到登录身份之后才订阅。
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`global-invites-${myId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "game_invites", filter: `to_id=eq.${myId}` },
        async (payload) => {
          const inv = payload.new;
          const { data: fromProfile } = await supabase
            .from("profiles").select("display_name, avatar_url").eq("id", inv.from_id).single();
          setIncomingInvite({
            id: inv.id,
            room_id: inv.room_id,
            fromName: fromProfile?.display_name,
            fromAvatar: fromProfile?.avatar_url,
          });
        }
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, [myId]);

  if (screen === "loading") {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {friendAddMsg && screen === "menu" && (
        <div className="panel" style={{ marginTop: 12, textAlign: "center" }}>
          <p>{friendAddMsg}</p>
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setFriendAddMsg(null)}>知道了</button>
        </div>
      )}

      {screen === "menu" && (
        <MainMenu onSelect={setScreen} playerName={profile?.display_name} rating={profile?.rating} avatarUrl={profile?.avatar_url} />
      )}
      {screen === "pve" && <PveScreen onExit={goMenu} />}
      {screen === "matchmaking" && (
        <MatchmakingScreen
          myId={myId}
          onMatched={handleMatched}
          onExit={goMenu}
          onFallbackToPve={() => setScreen("pve")}
        />
      )}
      {screen === "invite" && (
        <InviteScreen myId={myId} prefillCode={prefillRoomCode} onMatched={handleMatched} onExit={goMenu} />
      )}
      {screen === "room" && (
        <RoomScreen
          myId={myId}
          roomId={roomId}
          playerName={profile?.display_name}
          avatarUrl={profile?.avatar_url}
          rating={profile?.rating}
          onMatched={handleMatched}
          onExit={goMenu}
          onRandomMatch={() => setScreen("matchmaking")}
        />
      )}
      {screen === "friends" && (
        <FriendsScreen myId={myId} myFriendCode={profile?.friend_code} onMatched={handleMatched} onExit={goMenu} />
      )}
      {screen === "leaderboard" && <LeaderboardScreen myId={myId} onExit={goMenu} />}
      {screen === "profile" && <ProfileScreen myId={myId} onExit={goMenu} />}
      {screen === "game" && <OnlineGame roomId={roomId} myId={myId} onExit={goMenu} onMatched={handleMatched} />}

      {incomingInvite && (
        <IncomingInviteModal
          invite={incomingInvite}
          busy={inviteBusy}
          onAccept={handleAcceptInvite}
          onDecline={handleDeclineInvite}
        />
      )}
    </div>
  );
}
