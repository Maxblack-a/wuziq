# 墨局五子棋 (Gomoku Telegram Mini App)

一个可以在 Telegram 里直接玩的五子棋小游戏,支持:

- 🤖 人机对战(本地 AI,三档难度)
- 🎲 匹配对战(随机匹配陌生玩家)
- 🔗 邀请对战(生成房间号 / Telegram 深链接邀请好友)
- 👥 好友系统(好友码添加好友、邀请好友对战、接收对战邀请)
- 🏆 经验值成长体系(赢+10/输+4/和棋+6,只涨不降,6 段位 x 5 阶,带胜/负/平战绩与历史记录、排行榜)
- ⚡ 实时同步落子(Supabase Realtime)
- 🎨 自适应 Telegram 明暗主题

技术栈:**React + Vite**(前端)+ **Supabase**(数据库/实时/边缘函数)+ **Cloudflare Pages**(托管)。

---

## 一、Supabase 搭建(从零开始)

### 1. 创建项目
去 https://supabase.com → New Project,记下:
- `Project URL`(形如 `https://xxxx.supabase.co`)
- `anon public key`
- `service_role key`(仅用于 Edge Function,不要放进前端!)

### 2. 建表 + 安全加固补丁(必须按顺序全部跑完)

`supabase/` 目录下不止 `schema.sql` 一个文件——`schema.sql` 是主体(建表 + RLS + 核心函数),但落子防作弊、结算防伪造、单设备登录这些安全加固,以及棋力测试/每日试炼的 session 化,是分成好几个独立文件后补上去的。**漏跑任何一个,对应的漏洞就还在**(之前联机对局"点不了子"那次事故,起因就是漏看了这一条)。

进入 Supabase 控制台 → SQL Editor,新建查询,**按下面这个顺序,一个文件一个文件地**把整份内容粘贴进去执行(每个文件都用了 `if not exists`/`create or replace`/`drop ... if exists` 这类写法,重复执行是安全的,不会丢数据):

1. `supabase/schema.sql` —— 建表(`profiles`/`rooms`/`matchmaking_queue`/`friendships`/`game_invites`/`match_history` 等)+ RLS + 核心函数,以及每日试炼、棋力测试的基础结构
2. `supabase/security_hardening_p0.sql` —— 落子/结算安全加固(`make_move`/`finish_match` 加会话与权限校验,`profiles` 系统字段收紧成客户端不可写)
3. `supabase/lock_down_finish_match_internal.sql` —— 收紧内部函数(`_finish_match_internal`/`_validate_session`/`_disconnect_timeout`)的执行权限,不让客户端绕开上一步的校验直接调
4. `supabase/profiles_public_view.sql` —— 建 `profiles_public` 视图,查别人资料时只暴露安全字段,不再能查到 `profiles` 整行
5. `supabase/daily_trial_session_binding.sql` —— 每日试炼 session 化,堵住"没有真的开局就调结算"这条路
6. `supabase/daily_trial_quality_plausibility.sql` —— 每日试炼结算加一道耗时合理性校验,同时清理掉更早期一个不安全的 `finish_daily_trial` 历史重载(见下面"可以跳过"那条说明)
7. `supabase/skill_test_session_binding.sql` —— 棋力测试 session 化,道理跟第 5 条一样

**可以跳过、不建议再单独执行的历史文件**:`add_skill_test_history.sql`、`daily_trial_rating_sync_fixes.sql`、`daily_trial_per_npc_stats.sql`、`daily_trial_cold_start_from_npc_avg.sql` 这四个文件的内容,现在已经原样合并进第 1 步的 `schema.sql` 里了,继续留在目录里只是存档。**其中 `daily_trial_rating_sync_fixes.sql` 需要特别注意——它定义过一个不带 session/npc 校验的老版本 `finish_daily_trial`,如果单独执行会重新打开一个漏洞**,第 6 步已经加了防御性清理,只要按上面 1→7 的顺序执行就没问题,但不要再手动单独跑这四个历史文件。

> 如果不确定线上库现在到底跑到哪一步、有没有漏跑,去 SQL Editor 执行下面这段自查,把结果对照上面 1-7 的文件名过一遍,能唯一确定还差哪几步:
> ```sql
> select proname, pg_get_function_arguments(oid) as args
> from pg_proc where pronamespace = 'public'::regnamespace
>   and proname in ('make_move','finish_match','_finish_match_internal',
>                    'finish_daily_trial','start_skill_test','submit_skill_test_result')
> order by proname;
> ```
> `finish_daily_trial` 这一行如果查出来**不止一条**,说明有历史遗留的老签名没清理干净,需要手动执行 `drop function if exists finish_daily_trial(text, numeric);`。

这会创建:`profiles`(玩家资料)、`rooms`(对局房间)、`matchmaking_queue`(匹配队列)、`friendships`(好友关系)、`game_invites`(对战邀请通知)、`match_history`(战绩记录),以及必要的行级安全策略(RLS)和几个原子函数(`match_players` 匹配、`join_room` 加入房间、`add_friend_by_code` 加好友、`finish_match` 结算并计算经验值)。

> 如果你是在已经跑过一次旧版之后又拉取了新代码:上面 1-7 每一份都可以直接整份重新跑一遍,里面全部用了 `if not exists` / `create or replace` / `drop policy if exists`,重复执行是安全的。经验值改版(概念从"积分/rating"改名为"经验值/exp"、初始值 0、赢/输/和都直接加分、不再有负分)那部分带了列重命名 + `alter column ... set default` 语句,对已有项目同样安全,不会丢历史数据。

**关于经验值(EXP)**:新玩家初始经验值为 0,每局结束后赢 +10、输 +4、和棋 +6,只涨不降,没有扣分也不会出现负数,由数据库里的 `finish_match` 函数统一计算,前端不参与计算,避免有人从客户端伪造分数。段位分 6 档(棋童/棋士/高手/大师/宗师/棋圣),每档下再分 5 阶;越往后每阶跨度越大(棋童 100 分/阶,棋士 200 分/阶,高手 300 分/阶,大师 400 分/阶,宗师及以上 500 分/阶),展示层算法在 `src/lib/rank.js` 里。

**关于两种深链接**:邀请对局用 `?startapp=room_房间号`,加好友用 `?startapp=friend_好友码`,App 里会自动识别前缀分别处理,代码已经写好,不需要额外配置。

### 3. 开启 Realtime
控制台 → Database → Replication,把 `rooms` 表加入 Realtime 发布(`supabase_realtime` publication)。schema.sql 里已经用 SQL 自动加过,若没生效就手动勾选一下。

### 4. 部署 Edge Function(校验 Telegram 身份)
本地需要装 Supabase CLI:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <你的project-ref>
supabase secrets set TELEGRAM_BOT_TOKEN=<你的bot token>
supabase functions deploy telegram-auth --no-verify-jwt
```

这个函数的作用:Telegram 传来的用户信息(`initData`)必须在服务端校验签名,不能直接信任前端,否则任何人都能伪造成别人。函数校验通过后,会在 `profiles` 表里创建/更新这个玩家的资料。

---

## 二、Telegram Bot 与 Mini App 配置

1. 打开 Telegram,搜索 **@BotFather**,发送 `/newbot`,按提示起名字,拿到 `Bot Token`(就是上面 `TELEGRAM_BOT_TOKEN`)。
2. 发送 `/newapp`,选择刚才的 bot,填写 Mini App 的名字、描述、图标,**Web App URL 先随便填,等 Cloudflare 部署完成后回来改成真实域名**。
3. 记下 BotFather 给你的短名字(short name),邀请链接格式是:
   `https://t.me/<你的bot用户名>/<short name>?startapp=房间号`
   这个 `startapp` 参数就是我们用来传房间邀请码的。

---

## 三、前端配置与本地运行

```bash
cd gomoku-tg
npm install
cp .env.example .env
```

编辑 `.env`:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=你的anon key
```

本地预览(在电脑浏览器里,非 Telegram 环境会自动降级为"模拟模式"方便调试):
```bash
npm run dev
```

---

## 四、部署到 Cloudflare Pages

1. 把这个项目推到你自己的 GitHub 仓库。
2. Cloudflare Dashboard → Workers & Pages → 创建项目 → 连接 GitHub 仓库。
3. 构建设置:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - 输出目录: `dist`
4. 环境变量里加上 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`(和本地 `.env` 一样)。
5. 部署完成后拿到形如 `https://xxx.pages.dev` 的地址,回到 BotFather 用 `/myapps` 把 Web App URL 改成这个地址。

之后在 Telegram 里打开你的 bot,点开 Mini App 图标就能玩了。

---

## 五、目录结构

```
gomoku-tg/
├─ supabase/
│  ├─ schema.sql              # 建表 + RLS + 匹配函数
│  └─ functions/telegram-auth # 校验 Telegram 登录的边缘函数
├─ src/
│  ├─ lib/
│  │  ├─ supabase.js          # Supabase 客户端
│  │  └─ telegram.js          # Telegram WebApp SDK 封装
│  ├─ game/
│  │  ├─ logic.js             # 棋盘规则、胜负判断
│  │  └─ ai.js                # 人机对战 AI(启发式评分)
│  ├─ components/             # 各个界面
│  └─ styles/                 # 视觉样式(设计说明见下)
```

## 六、视觉设计说明

整体走「墨与玉」的东方棋局气质,而不是常见的 AI 生成模板配色:

- 背景:深墨色 `#15181B`,带极细的木纹/宣纸纹理
- 主色:玉石绿 `#2F6F5E`(按钮、当前回合高亮)
- 对局双方棋子:暖白 `#F3EEE3` 与墨黑 `#1E1E1E`,而不是纯色圆点,带柔和高光模拟真实棋子
- 强调色:琥珀 `#D68C45`,只用于胜负连线和重要提示,避免滥用
- 标题字体:`Noto Serif SC`(带笔锋感);正文/按钮:系统无衬线;房间号等数据用等宽字体,方便辨认相似字符
- 落子有"墨滴入局"式的缩放+微弹动画;获胜的五连棋子用手绘感的墨线连起来

同时会读取 Telegram 的主题变量(`--tg-theme-bg-color` 等),在 Telegram 内会自动贴合用户当前的明暗主题;在普通浏览器里用上面这套默认配色。

## 七、上线前建议检查一下限流

代码里目前没有做速率限制(比如有人写脚本疯狂猜好友码、疯狂调用匹配接口)。这不是代码层面能完全解决的,建议在 Supabase 控制台里顺手看一眼:

- **Authentication → Rate Limits**:限制登录/token 相关请求的频率
- **Edge Functions**:Supabase 本身对函数调用有默认配额,用量大了可以在这里升级
- 如果真的成了公开产品被滥用,可以考虑在 `telegram-auth` 函数里加一个按 `telegram_id` 或 IP 的简单节流(比如用一张表记录最近调用时间,超过频率直接拒绝)

好友码是 6 位、32 个字符的字母表(约 10 亿种组合),空间本身对暴力破解有一定抵抗力,但没有限流的话终究只是"比较难"而不是"不可能"。
