import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconChevronLeft } from "./Icons";
import SkillTestResultScreen from "./SkillTestResultScreen";
import { TYPE_DEFS } from "../lib/skillProfile";

// 从"我的"页面点"棋风"进来。两种状态:
// - 已经测过:回看当初测出来的六维图/类型——测完之后没有"重新测一次"
//   这个入口了(复测功能已经去掉,理由跟每日试炼的评分体系有关:
//   每日试炼那套按 NPC 存的持续对局数据,本身就是比"重新做一次结构化
//   测试"更准、更不需要玩家专门花时间的水平画像,复测能做的事已经
//   没剩多少了)。
// - 从没测过 / 之前跳过了:引导去测一次,这不是"复测",是这个玩家
//   第一次、也是唯一一次做这个测试。
//
// 只用 SkillTestResultScreen(纯数据那一屏),不会走到
// SkillTestEvaluationScreen(林墨点评那一屏)——回看历史要的是数据
// 本身,不需要每次都重新演一遍"让我想想怎么说"的停顿动画。
export default function SkillTestReviewScreen({ myId, onExit, onStartTest }) {
  useTelegramBackButton(onExit);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("skill_test_status, skill_test_dims, skill_test_type")
      .eq("id", myId)
      .single()
      .then(({ data }) => setProfile(data));
  }, [myId]);

  if (!profile) {
    return <div style={{ textAlign: "center", padding: 60 }}><div className="spinner" style={{ margin: "0 auto" }} /></div>;
  }

  const hasResult = profile.skill_test_status === "completed" && profile.skill_test_dims;
  const typeInfo = TYPE_DEFS[profile.skill_test_type] || TYPE_DEFS.balanced;

  return (
    <div>
      {!isInTelegram && (
        <div className="room-topbar" style={{ marginBottom: 4 }}>
          <button className="room-icon-btn" onClick={onExit} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
      )}

      {hasResult ? (
        <>
          <SkillTestResultScreen
            profile={{ dims: profile.skill_test_dims, type: profile.skill_test_type, typeInfo }}
            onContinue={onExit}
            continueLabel="返回"
          />
        </>
      ) : (
        <div style={{ padding: "40px var(--space-2)", textAlign: "center" }}>
          <p className="muted" style={{ marginBottom: 20 }}>还没有棋风测试记录</p>
          <button className="btn-primary" onClick={onStartTest}>去测一下</button>
        </div>
      )}
    </div>
  );
}
