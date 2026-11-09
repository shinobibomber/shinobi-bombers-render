-- Additive and idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only). Nothing here
-- changes balances, purchases, withdrawals, rewards or NFT records; those tables stay authoritative.
-- Times are epoch milliseconds, every key starts with scope, like the rest of schema.sql.
CREATE TABLE IF NOT EXISTS ryo_cc_control (
 scope TEXT PRIMARY KEY, roles_version INTEGER NOT NULL DEFAULT 0, installed BIGINT NOT NULL
);
-- Staff roles granted in the backend (Moderator, Support). Owner, Financial Approver, Game Operator and
-- Viewer come only from the hosting environment (RYO_ADMIN_* lists) and can never be granted here.
CREATE TABLE IF NOT EXISTS ryo_cc_roles (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('moderator','support')),
 granted_by TEXT NOT NULL, reason TEXT NOT NULL, created BIGINT NOT NULL, revoked BIGINT, revoked_by TEXT,
 PRIMARY KEY(scope,wallet,role)
);
-- Server-enforced chat standing, read by chat-send under the sender's account row lock.
CREATE TABLE IF NOT EXISTS ryo_cc_chat_status (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
 muted_until BIGINT NOT NULL DEFAULT 0, banned BOOLEAN NOT NULL DEFAULT FALSE, warnings INTEGER NOT NULL DEFAULT 0,
 last_warning TEXT, last_warning_at BIGINT, actor TEXT, updated BIGINT NOT NULL,
 PRIMARY KEY(scope,wallet)
);
-- One row per staff decision. request_id makes a retried request return the original result.
CREATE TABLE IF NOT EXISTS ryo_cc_chat_actions (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('warn','hide','unhide','mute','unmute','ban','unban')),
 target_wallet TEXT NOT NULL, message_id BIGINT, report_id BIGINT, duration_ms BIGINT,
 reason_code TEXT NOT NULL, reason TEXT NOT NULL, evidence_name TEXT, evidence_text TEXT,
 request_id TEXT NOT NULL, created BIGINT NOT NULL, UNIQUE(scope,actor,request_id)
);
CREATE INDEX IF NOT EXISTS ryo_cc_chat_actions_target ON ryo_cc_chat_actions(scope,target_wallet,created);
CREATE INDEX IF NOT EXISTS ryo_cc_chat_actions_actor ON ryo_cc_chat_actions(scope,actor,created);
-- Player reports keep a snapshot of the message, because chat keeps only the newest messages.
CREATE TABLE IF NOT EXISTS ryo_cc_chat_reports (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, message_id BIGINT NOT NULL, reporter TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('spam','scam','harassment','impersonation','offensive','other')),
 details TEXT, target_wallet TEXT NOT NULL, snapshot_name TEXT NOT NULL, snapshot_text TEXT NOT NULL, message_created BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','actioned','dismissed')),
 created BIGINT NOT NULL, resolved BIGINT, resolved_by TEXT, resolution TEXT,
 UNIQUE(scope,reporter,message_id,category)
);
CREATE INDEX IF NOT EXISTS ryo_cc_chat_reports_queue ON ryo_cc_chat_reports(scope,status,id);
CREATE INDEX IF NOT EXISTS ryo_cc_chat_reports_reporter ON ryo_cc_chat_reports(scope,reporter,created);
-- Official System announcements: proposed by one staff wallet, published only after a different one approves.
CREATE TABLE IF NOT EXISTS ryo_cc_announcements (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, text_en TEXT NOT NULL, text_pt TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected','unpublished')),
 version INTEGER NOT NULL DEFAULT 0, proposer TEXT NOT NULL, reason TEXT NOT NULL, created BIGINT NOT NULL,
 reviewer TEXT, review_reason TEXT, reviewed BIGINT, unpublished_by TEXT, unpublished BIGINT
);
CREATE INDEX IF NOT EXISTS ryo_cc_announcements_status ON ryo_cc_announcements(scope,status,id);
-- Idempotency receipts for every staff write: a repeated request ID returns the stored result.
CREATE TABLE IF NOT EXISTS ryo_cc_requests (
 scope TEXT NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL, action TEXT NOT NULL,
 result JSONB NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(scope,actor,request_id)
);
-- Hidden chat messages stay in the table (restricted evidence) but are no longer served to players.
ALTER TABLE ryo_chat ADD COLUMN IF NOT EXISTS hidden BIGINT;
