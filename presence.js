// 全局在线状态。之前只有"在同一局对局里"才知道对方在不在线(Presence
// 局限在那一个房间的channel里)。现在需要在"邀请好友"页面显示好友是否
// 在线,这需要一个应用级别、跟任何具体对局无关的Presence频道——
// 所有登录用户打开App之后都往这个频道里报到"我在线",谁都能看到全量列表。
//
// 用模块级单例 + 简易订阅者模式,而不是引入React Context,这样和项目里
// 其他"小hook"的写法保持一致(参考 useTelegramBackButton 那种风格)。
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

let channel = null;
let onlineIds = new Set();
const listeners = new Set();

function notify() {
  const snapshot = new Set(onlineIds);
  listeners.forEach((fn) => fn(snapshot));
}

// App启动、拿到登录用户id之后调用一次即可,内部做了单例保护,重复调用无副作用
export function initPresence(myId) {
  if (channel || !myId) return;

  channel = supabase.channel("online-users", { config: { presence: { key: myId } } });

  channel
    .on("presence", { event: "sync" }, () => {
      onlineIds = new Set(Object.keys(channel.presenceState()));
      notify();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ online: true });
    });
}

// 拿当前在线用户id集合(实时更新),用来判断某个好友是否在线
export function useOnlineUserIds() {
  const [ids, setIds] = useState(onlineIds);
  useEffect(() => {
    listeners.add(setIds);
    return () => listeners.delete(setIds);
  }, []);
  return ids;
}
