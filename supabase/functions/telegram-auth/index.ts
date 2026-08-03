// Supabase Edge Function: 校验 Telegram Mini App 的 initData
//
// 为什么需要这个函数:
// Telegram 前端 SDK 会给我们一份 initData(包含用户 id、名字、头像等),
// 但这份数据是可以被客户端伪造的。真正安全的做法是把 initData 原样发到
// 服务端,用 Bot Token 重新计算 HMAC 签名,和 Telegram 给的签名比对,
// 一致才能信任里面的用户信息。
//
// 部署: supabase functions deploy telegram-auth --no-verify-jwt
// 需要先: supabase secrets set TELEGRAM_BOT_TOKEN=xxxx

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hmacSha256(key: ArrayBuffer, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyInitData(initData: string): Promise<any | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const computedHash = toHex(await hmacSha256(secretKey.buffer, dataCheckString));

  if (computedHash !== hash) return null;

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return null; // 超过 24 小时的 initData 拒绝

  const userStr = params.get("user");
  return userStr ? JSON.parse(userStr) : null;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { initData } = await req.json();
    const tgUser = await verifyInitData(initData);

    if (!tgUser) {
      return new Response(JSON.stringify({ error: "签名校验失败" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 用 telegram_id 生成一个稳定、唯一的邮箱作为 auth.users 的登录凭证
    const fakeEmail = `tg_${tgUser.id}@telegram.local`;

    // 找有没有已存在的 profile
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    let userId: string;

    if (existing) {
      userId = existing.id;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: fakeEmail,
        email_confirm: true,
        password: crypto.randomUUID(),
      });

      if (createErr) {
        // 常见触发场景:上一次登录时 createUser 已经成功了,但紧接着的
        // profiles.upsert 因为网络抖动等原因失败——这样 auth.users 里其实
        // 已经有这个邮箱了,只是没有对应的 profiles 行。这种情况不能重新
        // createUser(邮箱已存在会直接报错卡死),改成按邮箱把已存在的账号
        // 找回来,而不是让这个用户从此再也登录不了。
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const found = !listErr && list?.users?.find((u) => u.email === fakeEmail);
        if (!found) throw createErr; // 不是"邮箱已存在"这种情况,是真的建号失败,原样抛出
        userId = found.id;
      } else {
        userId = created.user!.id;
      }
    }

    const { error: upsertErr } = await admin.from("profiles").upsert({
      id: userId,
      telegram_id: tgUser.id,
      username: tgUser.username ?? null,
      display_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" "),
      avatar_url: tgUser.photo_url ?? null,
    });

    if (upsertErr) {
      // 之前这里完全不检查结果——写失败也会假装登录成功,返回一个能拿到 session
      // 但实际上没有对应 profiles 行的账号,后续所有读资料的地方都会莫名其妙拿到空值。
      // 现在如实报错,让前端知道登录没有真正完成,可以重试。
      return new Response(JSON.stringify({ error: "写入用户资料失败,请重试: " + upsertErr.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 生成一个一次性登录链接,前端用它换取 session
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: fakeEmail,
    });
    if (linkErr) throw linkErr;

    return new Response(JSON.stringify({
      action_link: linkData.properties.action_link,
      user_id: userId,
    }), { headers: { ...cors, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
