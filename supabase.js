import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// supabase-js 默认会把登录态缓存在 localStorage 里并自动续期。Telegram Mini App
// 用户进进出出非常频繁,如果每次重开都不管三七二十一重新走一遍"调用 Edge Function
// 换 magic link 再兑换 session"这一整套流程,不仅白白多打好几次网络请求拖慢启动,
// 还可能撞上 Supabase Auth 对 magic link 生成频率的限流。先看看有没有现成的有效登录态。
export async function getExistingUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

// 用 Telegram initData 换取 Supabase 登录态
export async function loginWithTelegram(initData) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ initData }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  // action_link 是一次性魔法链接,取出里面的 token 换 session
  const url = new URL(data.action_link);
  const token_hash = url.searchParams.get("token");
  const { error } = await supabase.auth.verifyOtp({
    token_hash,
    type: "magiclink",
  });
  if (error) throw error;

  return data.user_id;
}

// 网页版用户名密码登录:跟 telegram-auth 的假邮箱思路一样,用用户名拼一个
// 固定格式的邮箱地址当 Supabase Auth 的登录凭证,这样"用户名"这个我们
// 自己业务上的概念,不需要额外建一张表去维护唯一性——Supabase 已经替
// 我们保证了 auth.users.email 唯一,拼邮箱这一步复用了这个保证。
function usernameToEmail(username) {
  return `user_${username.trim().toLowerCase()}@webuser.local`;
}

// 注册必须经过 password-auth 这个 Edge Function(需要 service role 权限
// 手动把邮箱标记为已验证,原因见该函数顶部注释)。这里注册成功后紧接着
// 用同一份用户名密码走一次真正的 signInWithPassword,拿到本地 session——
// 干净地把"建号"和"登录换 session"分成两步,而不是让 Edge Function 越权
// 帮用户签发 session。
//
// 下面这段刻意写得比平时啰嗦:请求可能在好几个不同的层次失败(网络/CORS
// 直接连不上、函数返回了非 JSON 的错误页、函数正常返回但业务逻辑报错),
// 表现在用户眼里都是"点了没反应",但原因天差地别。与其让浏览器自己吞成
// 一句语焉不详的 "Failed to fetch",这里把每一层拿到的诊断信息都原样
// 带进抛出的 Error 里,好让页面上能直接显示出来,不用再翻开发者工具。
export async function registerWithPassword(username, password) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/password-auth`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ username, password }),
    });
  } catch (networkErr) {
    // fetch 本身就抛出了,说明请求根本没有跑完一整趟(常见原因:函数没
    // 部署 / CORS 被浏览器拦下 / VITE_SUPABASE_URL 配置错误 / 断网)。
    throw new Error(
      `[网络层] 无法连接到 ${url}\n` +
      `可能原因:password-auth 函数未成功部署、CORS 被拦截、或 VITE_SUPABASE_URL 配置错误\n` +
      `浏览器原始报错: ${networkErr.message}`
    );
  }

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    // 拿到了 HTTP 响应,但内容不是 JSON——说明请求没有真正跑到我们自己
    // 写的函数代码里,而是被 Supabase 网关或者中间层拦截,返回了一个
    // HTML/纯文本的错误页(最典型:JWT 校验没关掉时网关直接拦截)。
    throw new Error(
      `[网关层] 服务器返回了非预期内容,HTTP 状态码 ${res.status}\n` +
      `原始响应(前200字符): ${rawText.slice(0, 200) || "(空)"}`
    );
  }

  if (!res.ok || data.error) {
    // 请求正常跑到了函数代码里,函数自己判定失败并返回了 error 字段——
    // 这是最"正常"的失败,比如用户名格式不对、用户名已被注册。
    throw new Error(`[业务层] ${data.error || "注册失败"}(HTTP ${res.status})`);
  }

  return loginWithPassword(username, password);
}

// 登录不需要走 Edge Function——账号在注册时已经被标记为邮箱已验证,
// 前端直接用 Supabase 官方的用户名密码校验就行,少一次网络往返。
export async function loginWithPassword(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // "Invalid login credentials" 是最常见的情况(用户名不存在或密码错),
    // 直接给友好提示;其他错误(网络失败、项目配置问题等)把 Supabase
    // 原始报错带出来,方便排查到底是哪个环节出的问题。
    if (/invalid login credentials/i.test(error.message || "")) {
      throw new Error("用户名或密码不正确");
    }
    throw new Error(`[登录失败] ${error.message}`);
  }
  return data.user.id;
}

// 本地浏览器调试时(不在 Telegram 里)用匿名登录代替,方便直接体验。
// 标记 is_guest,这样排行榜之类的公开列表可以把调试账号过滤掉,不跟真实用户混在一起
export async function loginAnonymously(displayName = "访客") {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  await supabase.from("profiles").upsert({
    id: data.user.id,
    display_name: displayName,
    is_guest: true,
  });
  return data.user.id;
}

// ============================================================
// 单设备登录会话控制
//
// active_session_id 存在 profiles 表里,每次"真正登录"(不是同一设备
// 缓存 session 重开 App)都会换一个新的,本地这份存的是"我这台设备最后
// 一次拿到的那个值"——跟服务端的对不上,就说明别处登录顶替了自己。
//
// 特意不用 localStorage(那是给"登录态本身"用的,supabase-js 自己在管),
// 用一个独立的 key,避免哪天排查问题的时候和 supabase-js 内部的存储搞混。
// ============================================================
const SESSION_ID_KEY = "wuzigix_active_session_id";

export function getStoredSessionId() {
  return localStorage.getItem(SESSION_ID_KEY);
}

function setStoredSessionId(id) {
  if (id) localStorage.setItem(SESSION_ID_KEY, id);
}

export function clearStoredSessionId() {
  localStorage.removeItem(SESSION_ID_KEY);
}

// 登录成功后调这个,顶替掉这个账号在别处的登录态。
// 如果账号在别的设备上正有一局对局在进行中,不会直接顶替——先把这个
// 情况报回去,让调用方决定是否要弹确认框,确认后再传 force=true 真正执行。
export async function claimSession(force = false) {
  const { data, error } = await supabase.rpc("claim_session", { p_force: force });
  if (error) throw error;
  if (data?.session_id) setStoredSessionId(data.session_id);
  return data; // { has_active_game, room_id } 或 { session_id }
}

// 对局进行中的心跳,别的地方判负逻辑要看这个时间戳有没有太久没刷新
export async function sendHeartbeat(roomId) {
  await supabase.rpc("heartbeat", { p_room_id: roomId });
}

// ============================================================
// 头像上传:"我的"页面点头像选图之后走这里。
// 1. 用 canvas 把原图裁成正方形、缩到 AVATAR_SIZE、转成 webp——不管
//    用户传的是几 MB 的手机原图,存进 Storage 的都是一张体积很小的
//    正方形 webp,列表/好友页那些小头像加载起来也快。
// 2. 固定存到 `${uid}/avatar.webp` 这一个路径,upsert 覆盖旧文件,
//    不会在 Storage 里越攒越多没用的历史头像。
// 3. Storage 公开桶的 public URL 是不带版本号的,同一个路径覆盖后
//    浏览器/CDN 可能还认得旧的缓存——URL 后面拼一个时间戳查询参数
//    绕开缓存,不然用户上传完发现头像"没变"。
// ============================================================
const AVATAR_BUCKET = "avatars";
const AVATAR_SIZE = 320;

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

async function fileToSquareWebpBlob(file) {
  const img = await fileToImage(file);
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  URL.revokeObjectURL(img.src);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("头像转换失败"))),
      "image/webp",
      0.85
    );
  });
}

// 裁剪+转 webp+上传+更新 profiles.avatar_url,返回新的头像 URL 给
// 调用方直接更新本地状态(不用等下一次重新拉 profile)。
export async function uploadAvatar(uid, file) {
  const blob = await fileToSquareWebpBlob(file);
  const path = `${uid}/avatar.webp`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", uid);
  if (updateError) throw updateError;

  return url;
}
