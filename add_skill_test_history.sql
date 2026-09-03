-- ============================================================
-- 新增:棋力测试历史表 skill_test_history
-- 在 Supabase 控制台 SQL Editor 里单独运行这一段即可,
-- 内容跟 schema.sql 里追加的部分完全一致,重复运行也安全。
-- ============================================================

create table if not exists skill_test_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  dims jsonb not null,
  type text not null,
  hidden_score int,
  confidence text,
  completed_at timestamptz not null default now()
);

create index if not exists skill_test_history_profile_idx
  on skill_test_history (profile_id, completed_at desc);

alter table skill_test_history enable row level security;

drop policy if exists "skill_test_history_select" on skill_test_history;
create policy "skill_test_history_select" on skill_test_history for select using (auth.uid() = profile_id);

drop policy if exists "skill_test_history_insert" on skill_test_history;
create policy "skill_test_history_insert" on skill_test_history for insert with check (auth.uid() = profile_id);
