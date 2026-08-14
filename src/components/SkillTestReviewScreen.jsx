import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconChevronLeft } from "./Icons";
import SkillTestResultScreen from "./SkillTestResultScreen";
import { TYPE_DEFS } from "../lib/skillProfile";

// 从"我的"页面点"棋风"进来。两种状态:
// - 已经测过:回看当初(或者最近一次重测)的六维图/类型,底部多一个
//   "重新测一次"的入口。
// - 从没测过 / 之前跳过了:没有数据可看,直接给一个引导去测的入口。
export default function SkillTestReviewScreen({ myId, onExit, onRetake }) {
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
            onContinue={onRetake}
            continueLabel="重新测一次"
          />
          <button className="btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={onExit}>
            返回
          </button>
        </>
      ) : (
        <div style={{ padding: "40px var(--space-2)", textAlign: "center" }}>
          <p className="muted" style={{ marginBottom: 20 }}>还没有棋力测试记录</p>
          <button className="btn-primary" onClick={onRetake}>去测一下</button>
        </div>
      )}
    </div>
  );
}
