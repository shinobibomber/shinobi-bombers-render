-- Additive monitoring and governance; existing Ryo tables remain the financial authority.
CREATE TABLE IF NOT EXISTS ryo_admin_control (
 scope TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0,
 config JSONB NOT NULL DEFAULT '{}', pauses JSONB NOT NULL DEFAULT '{}', installed BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ryo_admin_proposals (
 scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, payload JSONB NOT NULL,
 proposer TEXT NOT NULL, reviewer TEXT, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 version INTEGER NOT NULL, created BIGINT NOT NULL, reviewed BIGINT,
 PRIMARY KEY(scope,id), CHECK(status IN ('pending','approved','rejected'))
);
CREATE TABLE IF NOT EXISTS ryo_admin_audit (
 scope TEXT NOT NULL, sequence BIGINT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
 data JSONB NOT NULL, created BIGINT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL,
 PRIMARY KEY(scope,sequence)
);
CREATE TABLE IF NOT EXISTS ryo_reward_claims (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, wallet TEXT NOT NULL,
 amount BIGINT NOT NULL CHECK(amount>0), created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ryo_reward_claims_period ON ryo_reward_claims(scope,created,wallet);
CREATE INDEX IF NOT EXISTS ryo_purchases_admin_status ON ryo_purchases(scope,status,created);
CREATE INDEX IF NOT EXISTS ryo_withdrawals_admin_status ON ryo_withdrawals(scope,status,created);
