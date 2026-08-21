import { useEffect, useState } from "react";
import DailyTrialGameScreen from "./DailyTrialGameScreen";
import { IconChevronLeft, IconBolt, IconGem, IconFlame } from "./Icons";
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

// 顶部体力/钻石的小型状态条,非阻塞展示——每日试炼现在是"点开就直接
// 进对话"的流程,不再有单独一步"先看数据再点挑战"的大厅页,但玩家
// 还是需要能随时瞄一眼自己还剩多少体力/钻石,所以留一条不打断流程
// 的小状态条,贴在对话卡片上方。
function ResourceBar({ status }) {
  if (!status) return null;
  return (
    <div className="daily-trial-resource-bar">
      <span className="daily-trial-resource-item"><IconBolt size={13} /> {status.stamina}/{DAILY_STAMINA_CAP}</span>
      <span className="daily-trial-resource-item"><IconGem size={13} /> {status.diamonds}</span>
      {status.streak !== 0 && (
        <span className={`daily-trial-resource-item${status.streak > 0 ? " win" : " lose"}`}>
          <IconFlame size={13} /> {status.streak > 0 ? `连胜${status.streak}` : `连败${Math.abs(status.streak)}`}
        </span>
      )}
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
      setBattleSeed({ rating: started.rating, linmoRating: started.linmoRating, streak: started.streak });
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

  function handleAbortToChooseNext() {
    setChoosingNext({ note: dailyChooseNextLine() });
    setMode("choose_next");
  }

  if (mode === "battle" && battleSeed) {
    return (
      <DailyTrialGameScreen
        playerRating={battleSeed.rating}
        linmoRating={battleSeed.linmoRating}
        streak={battleSeed.streak}
        onFinish={handleBattleFinish}
        onAbort={handleAbortToChooseNext}
      />
    );
  }

  return (
    <div>
      {!isInTelegram && ["loading", "no_stamina", "greeting", "choose_next", "error"].includes(mode) && (
        <div className="room-topbar" style={{ marginBottom: 4 }}>
          <button className="room-icon-btn" onClick={onExit} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
      )}

      {(mode === "loading" || mode === "settling") && (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          {mode === "settling" && <p className="muted" style={{ marginTop: 12 }}>结算中…</p>}
        </div>
      )}

      {mode === "error" && (
        <div className="daily-trial-error">
          <p>{errorMsg || "出错了"}</p>
          <button className="btn-primary" onClick={loadStatus}>重试</button>
        </div>
      )}

      {mode === "no_stamina" && (
        <div className="daily-trial-lobby fade-in-up">
          <ResourceBar status={status} />
          <div className="daily-trial-npc-card">
            <div className="daily-trial-npc-avatar">
              <img src={npc?.portrait || "/linmo-portrait.webp"} alt={npc?.name || "林墨"} />
            </div>
            <div className="daily-trial-npc-name">{npc?.name || "林墨"}</div>
          </div>
          <div className="daily-trial-bubble">
            <p className="daily-trial-bubble-line">今天的体力好像不够了,明天再来吧。</p>
          </div>
          <div className="confirm-bar" style={{ marginTop: 20 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={onExitHome}>返回首页</button>
          </div>
        </div>
      )}

      {mode === "greeting" && greetingContent && (
        <div className="daily-trial-lobby fade-in-up">
          <ResourceBar status={status} />
          <div className="daily-trial-npc-card">
            <div className="daily-trial-npc-avatar">
              <img src={npc?.portrait} alt={npc?.name} />
            </div>
            <div className="daily-trial-npc-name">{npc?.name}</div>
          </div>
          <div className="daily-trial-bubble">
            <p className="daily-trial-bubble-line">{greetingContent.primary}</p>
            {greetingContent.secondary && (
              <p className="daily-trial-bubble-line daily-trial-bubble-line-secondary">{greetingContent.secondary}</p>
            )}
          </div>
          {errorMsg && <p className="daily-trial-error-text">{errorMsg}</p>}
          <div className="confirm-bar" style={{ marginTop: 20 }}>
            <button className="btn-ghost" style={{ flex: 1 }} onClick={handleDeclineGreeting} disabled={starting}>
              {DAILY_DECLINE_LABEL}
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={beginBattle} disabled={starting}>
              {starting ? "准备中…" : DAILY_ACCEPT_LABEL}
            </button>
          </div>
        </div>
      )}

      {mode === "result_reveal" && lastReward && (
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
      )}

      {mode === "review" && reviewContent && (
        <div className="daily-trial-lobby fade-in-up">
          <ResourceBar status={status} />
          <div className="daily-trial-npc-card">
            <div className="daily-trial-npc-avatar">
              <img src={npc?.portrait} alt={npc?.name} />
            </div>
            <div className="daily-trial-npc-name">{npc?.name}</div>
          </div>
          <div className="daily-trial-bubble">
            <p className="daily-trial-bubble-line">{reviewContent.comment}</p>
            {reviewContent.line2 && <p className="daily-trial-bubble-line daily-trial-bubble-line-secondary">{reviewContent.line2}</p>}
            {reviewContent.line3 && <p className="daily-trial-bubble-line daily-trial-bubble-line-secondary">{reviewContent.line3}</p>}
          </div>

          {reviewContent.phase === "stamina_exhausted" && (
            <div className="confirm-bar" style={{ marginTop: 20 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={onExitHome}>返回首页</button>
            </div>
          )}

          {reviewContent.phase === "npc_offer" && (
            <div className="confirm-bar" style={{ marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={handleRematchDecline} disabled={starting}>
                {DAILY_REMATCH_DECLINE_LABEL}
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleRematchAccept} disabled={starting}>
                {starting ? "准备中…" : DAILY_REMATCH_ACCEPT_LABEL}
              </button>
            </div>
          )}

          {reviewContent.phase === "neutral" && (
            <div className="confirm-bar" style={{ marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={handlePickOther}>
                {DAILY_PICK_OTHER_LABEL}
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlayerInvite}>
                {DAILY_INVITE_NPC_LABEL}
              </button>
            </div>
          )}

          {reviewContent.phase === "player_invite_accepted" && (
            <div className="confirm-bar" style={{ marginTop: 20 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleRematchAccept} disabled={starting}>
                {starting ? "准备中…" : "开始对局"}
              </button>
            </div>
          )}

          {reviewContent.phase === "player_invite_declined" && (
            <div className="confirm-bar" style={{ marginTop: 20 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handlePickOther}>知道了</button>
            </div>
          )}
        </div>
      )}

      {mode === "choose_next" && choosingNext && (
        <div className="daily-trial-lobby fade-in-up">
          <ResourceBar status={status} />
          <div className="daily-trial-bubble" style={{ textAlign: "center" }}>
            <p className="daily-trial-bubble-line">{choosingNext.note}</p>
          </div>
          <div className="confirm-bar" style={{ marginTop: 20 }}>
            <button className="btn-ghost" style={{ flex: 1 }} onClick={onExitHome}>
              {DAILY_BACK_HOME_LABEL}
            </button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={handleMatchNext}>
              {DAILY_MATCH_NEXT_LABEL}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
