// Supabase Edge Function: 网页版"用户名 + 密码"注册
//
// 为什么需要单独一个函数,而不是前端直接调 supabase.auth.signUp():
// Supabase 项目默认开着"Confirm email"(注册后要点邮件里的确认链接才能
// 登录)。我们这里用用户名拼出来的假邮箱(xxx@webuser.local)根本收不到
// 邮件,如果不绕过这一步,注册完账号会直接卡死,永远登录不进去。
// 绕过的办法是用 service role 调 admin.createUser,手动传 email_confirm:
// true——这个权限只有服务端有,所以注册必须经过这个函数;登录不需要,
// 前端直接用 supabase.auth.signInWithPassword() 就行。
//
// 部署: supabase functions deploy password-auth --no-verify-jwt
// (跟 telegram-auth 共用同一个 SUPABASE_SERVICE_ROLE_KEY,不需要额外配置)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 用户名规则:字母/数字/下划线,3-20 位。限制成纯 ASCII 是因为这个用户名
// 要直接拼进邮箱地址(user_xxx@webuser.local)当登录凭证用,中文/特殊符号
// 放进邮箱地址容易在各个环节(Supabase Auth、SMTP 相关校验)出奇怪的问题。
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function usernameToEmail(username: string) {
  return `user_${username.toLowerCase()}@webuser.local`;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { username, password } = await req.json();

    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      return new Response(JSON.stringify({ error: "用户名需为 3-20 位字母、数字或下划线" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 72) {
      return new Response(JSON.stringify({ error: "密码长度需为 6-72 位" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const email = usernameToEmail(username);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 关键:手动标记邮箱已验证,不然这个假邮箱收不到确认信,账号会永远卡在未激活
    });

    if (createErr) {
      // Supabase 对"邮箱已存在"报的错不总是同一个措辞/状态码,做一个宽松匹配,
      // 避免把真正的系统性错误也误判成"用户名被占用"。
      const msg = String(createErr.message || createErr);
      if (/already|registered|exists/i.test(msg)) {
        return new Response(JSON.stringify({ error: "用户名已被注册" }), {
          status: 409, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      throw createErr;
    }

    const userId = created.user!.id;

    // display_name 直接用用户名当默认值;nickname_confirmed 直接标 true——
    // 用户注册这一步已经手动输入过一个自己想要的名字了,不需要再走一遍
    // Telegram 那套"确认昵称"流程。
    const { error: upsertErr } = await admin.from("profiles").upsert({
      id: userId,
      username,
      display_name: username,
      nickname_confirmed: true,
    });

    if (upsertErr) {
      return new Response(JSON.stringify({ error: "写入用户资料失败,请重试: " + upsertErr.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
