import { useEffect, useState } from "react";
import MainMenu from "./components/MainMenu";
import PveScreen from "./components/PveScreen";
import MatchmakingScreen from "./components/MatchmakingScreen";
import InviteScreen from "./components/InviteScreen";
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
  const [screen, setScreen] = useState("loading"); // loading | menu | pve | matchmaking | invite | game | friends | leaderboard | profile
  const [roomId, setRoomId] = useState(null);
  const [prefillRoomCode, setPrefillRoomCode] = useState(null);
  const [friendAddMsg, setFriendAddMsg] = useState(null);

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
          .select("id")
          .or(
            `and(status.eq.playing,or(player1_id.eq.${uid},player2_id.eq.${uid})),` +
            `and(status.eq.waiting,player1_id.eq.${uid})`
          )
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeRoom) {
          setRoomId(activeRoom.id);
          setScreen("game");
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

  function handleMatched(id) {
    setRoomId(id);
    setScreen("game");
  }

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
        <MainMenu onSelect={setScreen} playerName={profile?.display_name} rating={profile?.rating} />
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
      {screen === "friends" && (
        <FriendsScreen myId={myId} myFriendCode={profile?.friend_code} onMatched={handleMatched} onExit={goMenu} />
      )}
      {screen === "leaderboard" && <LeaderboardScreen myId={myId} onExit={goMenu} />}
      {screen === "profile" && <ProfileScreen myId={myId} onExit={goMenu} />}
      {screen === "game" && <OnlineGame roomId={roomId} myId={myId} onExit={goMenu} onMatched={handleMatched} />}
    </div>
  );
}
