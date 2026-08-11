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
export async function registerWithPassword(username, password) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/password-auth`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ username, password }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return loginWithPassword(username, password);
}

// 登录不需要走 Edge Function——账号在注册时已经被标记为邮箱已验证,
// 前端直接用 Supabase 官方的用户名密码校验就行,少一次网络往返。
export async function loginWithPassword(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("用户名或密码不正确");
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
