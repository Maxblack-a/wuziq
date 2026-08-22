import { useEffect, useState } from "react";
import DailyTrialGameScreen from "./DailyTrialGameScreen";
import { IconChevronLeft, IconBolt, IconGem, IconFlame, IconArrowRight, IconSparkle } from "./Icons";
import { getDailyTrialStatus, startDailyTrial, finishDailyTrial } from "../lib/dailyTrial";
import { pickRandomNpc } from "../lib/npcRoster";
import {
  dailyFirstMeetingInviteLine, dailyReturnGreetingLine, pickSmallTalkLine,
  DAILY_ACCEPT_LABEL, DAILY_DECLINE_LABEL, dailyPlayerDeclinedResponseLine,
  dailyResultLine, dailyRematchInviteLine, DAILY_REMATCH_ACCEPT_LABEL, DAILY_REMATCH_DECLINE_LABEL,
  dailyNoRematchOfferLine, DAILY_INVITE_NPC_LABEL, DAILY_PICK_OTHER_LABEL,
  dailyAcceptPlayerInviteLine, dailyPlayerInviteDeclineReason, dailyStaminaExhaustedLine,
  dailyChooseNextLine, DAILY_MATCH_NEXT_LABEL, DAILY_BACK_HOME_LABEL,
} from "../lib/linmoDialogue";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { STAMINA_COST, DAILY_STAMINA_CAP, rollNpcInvitesRematch, rollNpcAcceptsPlayerInvite } from "../game/dailyTrialEngine";

const RESULT_COPY = {
  win: { title: "胜局", color: "var(--wood)" },
  lose: { title: "败局", color: "var(--gold)" },
  draw: { title: "和棋", color: "var(--fg)" },
};

// 每日试炼的见面邀请/点评续约/换对手/体力不足这几步,跟填昵称、邀请
// 棋力测试是同一场戏的延续,所以沿用完全同一套"图片背景 + 信笺气泡 +
// 胶囊按钮"视觉(.linmo-scene 系统,定义在 linmo.css),不重新发明一套
// 卡片式 UI。这个 SceneShell 就是把 LinMoIntroScreen / LinMoRetakeIntroScreen
// 里那段背景图+品牌区的骨架抽出来复用,每日试炼比那两个场景多两样
// 东西:左上角的返回按钮(填昵称/棋力测试邀请是没有退出口的强制流程,
// 每日试炼是可以随时退出的可选玩法)、右上角的体力/钻石/连胜状态条。
function SceneShell({ npc, status, onBack, children }) {
  return (
    <div className="linmo-scene">
      <picture>
        <source srcSet={npc?.sceneWebp || "/linmo-scene.webp"} type="image/webp" />
        <img
          className="linmo-scene-bg"
          src={npc?.scene || "/linmo-scene.jpg"}
          width="941"
          height="1672"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
        />
      </picture>

      {onBack && (
        <button className="linmo-scene-back-btn" onClick={onBack} aria-label="返回">
          <IconChevronLeft size={18} />
        </button>
      )}

      {status && (
        <div className="linmo-scene-resource-bar">
          <span className="linmo-scene-resource-item"><IconBolt size={12} /> {status.stamina}/{DAILY_STAMINA_CAP}</span>
          <span className="linmo-scene-resource-item"><IconGem size={12} /> {status.diamonds}</span>
          {status.streak !== 0 && (
            <span className={`linmo-scene-resource-item${status.streak > 0 ? " win" : " lose"}`}>
              <IconFlame size={12} /> {status.streak > 0 ? `连胜${status.streak}` : `连败${Math.abs(status.streak)}`}
            </span>
          )}
        </div>
      )}

      <div className="linmo-scene-column">
        <div className="linmo-brand-block">
          <div className="linmo-brand-name">WUZIQIX</div>
          <div className="linmo-brand-title-row">
            <h1>五子棋</h1>
            <span className="linmo-brand-seal">规</span>
          </div>
          <p className="linmo-brand-slogan">黑白之间 · 一念胜负</p>
        </div>
        {children}
      </div>
    </div>
  );
}

// 信笺气泡:NPC 落款 + 一到三行台词 + 收尾细线,跟棋力测试邀请那屏
// 用的是同一套 .linmo-invite-bubble 结构,只是这里可能要连着说好几句
// (点评 + 续约邀请/理由),所以台词是个数组,依次渲染。
function InviteBubble({ npc, lines }) {
  return (
    <div className="linmo-bubble linmo-invite-bubble">
      <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
      <div className="linmo-invite-bubble-name">
        {npc?.name}<span className="linmo-invite-bubble-name-icon"><IconSparkle size={11} /></span>
      </div>
      <div className="linmo-invite-bubble-divider" />
      {lines.filter(Boolean).map((line, i) => (
        <p key={i} className={`linmo-bubble-line linmo-invite-bubble-line${i > 0 ? " linmo-invite-bubble-line-secondary" : ""}`}>
          {line}
        </p>
      ))}
      <div className="linmo-invite-bubble-end-divider"><span className="linmo-invite-bubble-end-divider-dot" /></div>
    </div>
  );
}

// 每日试炼:点进来直接是"跟 NPC 对话"的邀请界面,不是一个先看数据、
// 再手动点"挑战"的大厅——见面寒暄(区分是不是第一次在每日试炼里遇到
// 这位棋手)→ 邀请对局 → 对局 → 结算 → 赛后点评 → 续约协商(NPC 可能
// 主动邀请下一局,也可能不邀请,这时候轮到玩家主动开口;不管谁提议,
// 对方都能接受/拒绝,拒绝时 NPC 一定会给理由)→ 双方都不继续时,可以
// 换一位棋手(目前名册里只有林墨,但走的是同一套"随机匹配"逻辑,以后
// 加新棋手不用改这个组件)或者直接回首页。
//
// mode 的完整状态机:
//   loading -> no_stamina | greeting
//   greeting -[接受]-> battle
//   greeting -[拒绝]-> choose_next
//   battle -> settling -> result_reveal -[继续]-> review
//   review 内部按 reviewContent.phase 再细分几种子状态(见 prepareReview)
//   review -> battle(续约成功) | choose_next(续约没谈成) | no_stamina(体力耗尽还想继续)
//   choose_next -[匹配下一位棋手]-> greeting(新 NPC) | no_stamina
//   choose_next -[返回首页]-> 退出
export default function DailyTrialScreen({ onExit, onExitHome }) {
  const [mode, setMode] = useState("loading");
  const [status, setStatus] = useState(null);
  const [npc, setNpc] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [starting, setStarting] = useState(false);

  const [greetingContent, setGreetingContent] = useState(null); // { primary, secondary }
  const [battleSeed, setBattleSeed] = useState(null);
  const [lastReward, setLastReward] = useState(null); // { result, exp, diamonds }
  const [reviewContent, setReviewContent] = useState(null); // { comment, phase, line2, line3 }
  const [choosingNext, setChoosingNext] = useState(null); // { note }

  // 只在这几个"停下来等玩家选择"的状态里把 Telegram 原生返回键交给
  // 自己处理;对局中(battle)交给 DailyTrialGameScreen 自己接管,
  // 结算/点评这几步(settling/result_reveal/review)强制走界面里的按钮,
  // 不响应返回键,避免手滑跳过还没确认的续约协商。
  const backHandled = ["loading", "no_stamina", "greeting", "choose_next", "error"].includes(mode);
  useTelegramBackButton(backHandled ? onExit : undefined);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    setMode("loading");
    setErrorMsg("");
    try {
      const s = await getDailyTrialStatus();
      setStatus(s);
      if (s.stamina < STAMINA_COST) {
        setMode("no_stamina");
      } else {
        enterGreeting(s, npc || pickRandomNpc());
      }
    } catch (e) {
      console.error("加载每日试炼状态失败", e);
      setErrorMsg("加载失败,请重试");
      setMode("error");
    }
  }

  function enterGreeting(currentStatus, chosenNpc) {
    setNpc(chosenNpc);
    const isFirst = !currentStatus || currentStatus.gamesPlayed === 0;
    const primary = isFirst ? dailyFirstMeetingInviteLine() : dailyReturnGreetingLine(currentStatus.streak);
    const secondary = isFirst ? null : pickSmallTalkLine();
    setGreetingContent({ primary, secondary });
    setMode("greeting");
  }

  // 三个不同入口(首次邀请接受 / 林墨主动续约接受 / 玩家主动邀请后林墨
  // 答应)最终做的事完全一样:调服务器扣体力、拿到这一局的评分快照、
  // 进战斗——所以统一收到这一个函数里,不重复写三遍。
  async function beginBattle() {
    if (starting) return;
    setStarting(true);
    setErrorMsg("");
    try {
      const started = await startDailyTrial();
      setStatus((prev) => ({ ...prev, ...started }));
      setBattleSeed({
        rating: started.rating,
        linmoRating: started.linmoRating,
        streak: started.streak,
        gamesPlayed: status?.gamesPlayed ?? 0,
      });
      setMode("battle");
    } catch (e) {
      console.error("开始每日试炼失败", e);
      if (e?.message === "体力不足") {
        setMode("no_stamina");
      } else {
        setErrorMsg("开始失败,请重试");
      }
    } finally {
      setStarting(false);
    }
  }

  function handleDeclineGreeting() {
    setChoosingNext({ note: dailyPlayerDeclinedResponseLine() });
    setMode("choose_next");
  }

  function handleAbortToChooseNext() {
    setChoosingNext({ note: dailyChooseNextLine() });
    setMode("choose_next");
  }

  async function handleBattleFinish(result, quality) {
    setMode("settling");
    try {
      const reward = await finishDailyTrial(result, quality);
      const nextStatus = {
        stamina: status?.stamina ?? 0, // battle 开始时已经扣过体力,settle 不改体力,这里沿用当前值
        diamonds: reward.diamonds,
        rating: reward.rating,
        linmoRating: reward.linmoRating,
        streak: reward.streak,
        bestStreak: reward.bestStreak,
        gamesPlayed: (status?.gamesPlayed ?? 0) + 1,
        wins: (status?.wins ?? 0) + (result === "win" ? 1 : 0),
      };
      setStatus(nextStatus);
      setLastReward({ result, exp: reward.exp, diamonds: reward.diamonds });
      setMode("result_reveal");
      // reviewContent 提前算好,点"继续"那一刻直接展示,不用再等一次
      // 网络请求或者计算——续约要不要邀请只取决于概率 + 当前体力,
      // 这两样这里都已经拿到了。
      prepareReview(nextStatus, result);
    } catch (e) {
      console.error("结算每日试炼失败", e);
      setErrorMsg("结算失败,请重试");
      setMode("error");
    }
  }

  function prepareReview(currentStatus, result) {
    const comment = dailyResultLine(result);
    if (currentStatus.stamina < STAMINA_COST) {
      setReviewContent({ comment, phase: "stamina_exhausted", line2: dailyStaminaExhaustedLine() });
      return;
    }
    if (rollNpcInvitesRematch()) {
      setReviewContent({ comment, phase: "npc_offer", line2: dailyRematchInviteLine() });
    } else {
      setReviewContent({ comment, phase: "neutral", line2: dailyNoRematchOfferLine() });
    }
  }

  function handleRematchAccept() {
    beginBattle();
  }

  function handleRematchDecline() {
    setChoosingNext({ note: dailyChooseNextLine() });
    setMode("choose_next");
  }

  function handlePlayerInvite() {
    if (rollNpcAcceptsPlayerInvite()) {
      setReviewContent((prev) => ({ ...prev, phase: "player_invite_accepted", line3: dailyAcceptPlayerInviteLine() }));
    } else {
      setReviewContent((prev) => ({ ...prev, phase: "player_invite_declined", line3: dailyPlayerInviteDeclineReason() }));
    }
  }

  function handlePickOther() {
    setChoosingNext({ note: dailyChooseNextLine() });
    setMode("choose_next");
  }

  function handleMatchNext() {
    if (!status || status.stamina < STAMINA_COST) {
      setMode("no_stamina");
      return;
    }
    const nextNpc = pickRandomNpc(npc?.id);
    enterGreeting(status, nextNpc);
  }

  if (mode === "battle" && battleSeed) {
    return (
      <DailyTrialGameScreen
        playerRating={battleSeed.rating}
        linmoRating={battleSeed.linmoRating}
        streak={battleSeed.streak}
        gamesPlayed={battleSeed.gamesPlayed}
        onFinish={handleBattleFinish}
        onAbort={handleAbortToChooseNext}
      />
    );
  }

  if (mode === "loading" || mode === "settling") {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div className="spinner" style={{ margin: "0 auto" }} />
        {mode === "settling" && <p className="muted" style={{ marginTop: 12 }}>结算中…</p>}
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="daily-trial-error">
        <p>{errorMsg || "出错了"}</p>
        <button className="btn-primary" onClick={loadStatus}>重试</button>
      </div>
    );
  }

  if (mode === "no_stamina") {
    return (
      <SceneShell npc={npc} status={status} onBack={onExit}>
        <InviteBubble npc={npc} lines={["今天的体力好像不够了,明天再来吧。"]} />
        <div className="linmo-actions-row linmo-invite-actions-row">
          <button className="linmo-cta linmo-invite-cta" onClick={onExitHome}>
            <span>返回首页</span>
            <IconArrowRight size={16} />
          </button>
        </div>
      </SceneShell>
    );
  }

  if (mode === "greeting" && greetingContent) {
    return (
      <SceneShell npc={npc} status={status} onBack={onExit}>
        <InviteBubble npc={npc} lines={[greetingContent.primary, greetingContent.secondary]} />
        {errorMsg && <p className="linmo-error">{errorMsg}</p>}
        <div className="linmo-actions-row linmo-invite-actions-row">
          <button className="linmo-cta linmo-invite-cta" onClick={beginBattle} disabled={starting}>
            <span>{starting ? "准备中…" : DAILY_ACCEPT_LABEL}</span>
            {!starting && <IconArrowRight size={16} />}
          </button>
          <button className="btn-ghost linmo-invite-skip" onClick={handleDeclineGreeting} disabled={starting}>
            {DAILY_DECLINE_LABEL}
          </button>
        </div>
      </SceneShell>
    );
  }

  if (mode === "result_reveal" && lastReward) {
    return (
      <div className="daily-trial-result fade-in-up">
        <h2 className="pve-result-title" style={{ color: RESULT_COPY[lastReward.result].color }}>
          {RESULT_COPY[lastReward.result].title}
        </h2>
        {lastReward.result === "win" ? (
          <div className="daily-trial-reward-row">
            <span className="daily-trial-reward-pill">+{lastReward.exp} 经验</span>
            <span className="daily-trial-reward-pill"><IconGem size={13} /> +1 钻石</span>
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 4 }}>
            再接再厉,状态说不定下一局就回来了。
          </p>
        )}
        <div className="confirm-bar" style={{ marginTop: 24 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={() => setMode("review")}>继续</button>
        </div>
      </div>
    );
  }

  if (mode === "review" && reviewContent) {
    return (
      <SceneShell npc={npc} status={status} onBack={undefined}>
        <InviteBubble npc={npc} lines={[reviewContent.comment, reviewContent.line2, reviewContent.line3]} />

        {reviewContent.phase === "stamina_exhausted" && (
          <div className="linmo-actions-row linmo-invite-actions-row">
            <button className="linmo-cta linmo-invite-cta" onClick={onExitHome}>
              <span>返回首页</span>
              <IconArrowRight size={16} />
            </button>
          </div>
        )}

        {reviewContent.phase === "npc_offer" && (
          <div className="linmo-actions-row linmo-invite-actions-row">
            <button className="linmo-cta linmo-invite-cta" onClick={handleRematchAccept} disabled={starting}>
              <span>{starting ? "准备中…" : DAILY_REMATCH_ACCEPT_LABEL}</span>
              {!starting && <IconArrowRight size={16} />}
            </button>
            <button className="btn-ghost linmo-invite-skip" onClick={handleRematchDecline} disabled={starting}>
              {DAILY_REMATCH_DECLINE_LABEL}
            </button>
          </div>
        )}

        {reviewContent.phase === "neutral" && (
          <div className="linmo-actions-row linmo-invite-actions-row">
            <button className="linmo-cta linmo-invite-cta" onClick={handlePlayerInvite}>
              <span>{DAILY_INVITE_NPC_LABEL}</span>
              <IconArrowRight size={16} />
            </button>
            <button className="btn-ghost linmo-invite-skip" onClick={handlePickOther}>
              {DAILY_PICK_OTHER_LABEL}
            </button>
          </div>
        )}

        {reviewContent.phase === "player_invite_accepted" && (
          <div className="linmo-actions-row linmo-invite-actions-row">
            <button className="linmo-cta linmo-invite-cta" onClick={handleRematchAccept} disabled={starting}>
              <span>{starting ? "准备中…" : "开始对局"}</span>
              {!starting && <IconArrowRight size={16} />}
            </button>
          </div>
        )}

        {reviewContent.phase === "player_invite_declined" && (
          <div className="linmo-actions-row linmo-invite-actions-row">
            <button className="linmo-cta linmo-invite-cta" onClick={handlePickOther}>
              <span>知道了</span>
              <IconArrowRight size={16} />
            </button>
          </div>
        )}
      </SceneShell>
    );
  }

  if (mode === "choose_next" && choosingNext) {
    return (
      <SceneShell npc={npc} status={status} onBack={onExit}>
        <InviteBubble npc={npc} lines={[choosingNext.note]} />
        <div className="linmo-actions-row linmo-invite-actions-row">
          <button className="linmo-cta linmo-invite-cta" onClick={handleMatchNext}>
            <span>{DAILY_MATCH_NEXT_LABEL}</span>
            <IconArrowRight size={16} />
          </button>
          <button className="btn-ghost linmo-invite-skip" onClick={onExitHome}>
            {DAILY_BACK_HOME_LABEL}
          </button>
        </div>
      </SceneShell>
    );
  }

  return null;
}
