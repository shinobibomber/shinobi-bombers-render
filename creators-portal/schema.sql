-- Creators Portal v1: CP uses integer milli-points, separate from all Ryo accounts.
CREATE TABLE IF NOT EXISTS ryo_creator_program (
 scope TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, config JSONB NOT NULL DEFAULT '{}', created BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ryo_creators (
 scope TEXT NOT NULL, id TEXT NOT NULL, wallet TEXT NOT NULL, display_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 code TEXT NOT NULL, application JSONB NOT NULL DEFAULT '{}', public_note TEXT NOT NULL DEFAULT '',
 reviewed_by TEXT, created BIGINT NOT NULL, reviewed BIGINT, balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0),
 PRIMARY KEY(scope,id), UNIQUE(scope,wallet), UNIQUE(scope,code)
);
CREATE INDEX IF NOT EXISTS ryo_creators_review ON ryo_creators(scope,status,created);
-- Wallet aliases remain reserved permanently after a dual-authenticated migration.
CREATE TABLE IF NOT EXISTS ryo_creator_wallets (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, creator_id TEXT NOT NULL,
 PRIMARY KEY(scope,wallet), FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id)
);
CREATE TABLE IF NOT EXISTS ryo_creator_referrals (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, creator_id TEXT NOT NULL, attributed BIGINT NOT NULL,
 paid_mints INTEGER NOT NULL DEFAULT 0 CHECK(paid_mints>=0), stage5 BIGINT, proof JSONB NOT NULL DEFAULT '{}',
 qualified BIGINT, expires BIGINT, rules JSONB, pending_initialized BOOLEAN NOT NULL DEFAULT FALSE,
 risk TEXT NOT NULL DEFAULT '', appeal TEXT NOT NULL DEFAULT '', PRIMARY KEY(scope,wallet),
 FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_creator_referrals_creator ON ryo_creator_referrals(scope,creator_id,attributed);
CREATE TABLE IF NOT EXISTS ryo_creator_events (
 scope TEXT NOT NULL, event_id TEXT NOT NULL, wallet TEXT NOT NULL, kind TEXT NOT NULL, payload JSONB NOT NULL,
 created BIGINT NOT NULL, PRIMARY KEY(scope,event_id)
);
CREATE TABLE IF NOT EXISTS ryo_creator_ledger (
 sequence BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, creator_id TEXT NOT NULL, event_id TEXT NOT NULL,
 kind TEXT NOT NULL, delta BIGINT NOT NULL, source_sr BIGINT NOT NULL DEFAULT 0,
 detail JSONB NOT NULL DEFAULT '{}', created BIGINT NOT NULL, UNIQUE(scope,event_id),
 FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_creator_ledger_creator ON ryo_creator_ledger(scope,creator_id,sequence);
-- FIFO lots distinguish prequalification/out-of-window earnings from eligible claimed earnings.
CREATE TABLE IF NOT EXISTS ryo_creator_adventure_lots (
 id BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, wallet TEXT NOT NULL, event_id TEXT NOT NULL,
 remaining BIGINT NOT NULL CHECK(remaining>=0), eligible BOOLEAN NOT NULL, created BIGINT NOT NULL,
 UNIQUE(scope,event_id)
);
CREATE INDEX IF NOT EXISTS ryo_creator_lots_pending ON ryo_creator_adventure_lots(scope,wallet,id) WHERE remaining>0;
CREATE TABLE IF NOT EXISTS ryo_creator_commissions (
 scope TEXT NOT NULL, source_id TEXT NOT NULL, creator_id TEXT NOT NULL, wallet TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('adventure','purchase')), sr_milli BIGINT NOT NULL CHECK(sr_milli>0),
 cp_milli BIGINT NOT NULL CHECK(cp_milli>=0), created BIGINT NOT NULL, PRIMARY KEY(scope,source_id),
 FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_creator_commissions_creator ON ryo_creator_commissions(scope,creator_id,created);
CREATE TABLE IF NOT EXISTS ryo_creator_shop (
 scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
 price BIGINT NOT NULL CHECK(price>0), supply INTEGER NOT NULL CHECK(supply>=0), used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
 monthly_limit INTEGER NOT NULL CHECK(monthly_limit>0), enabled BOOLEAN NOT NULL DEFAULT TRUE,
 version INTEGER NOT NULL DEFAULT 1, detail TEXT NOT NULL DEFAULT '', PRIMARY KEY(scope,id), CHECK(used<=supply)
);
CREATE TABLE IF NOT EXISTS ryo_creator_redemptions (
 scope TEXT NOT NULL, id TEXT NOT NULL, creator_id TEXT NOT NULL, wallet TEXT NOT NULL, item_id TEXT NOT NULL,
 price BIGINT NOT NULL, item_version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('fulfilled','reversed')),
 result JSONB NOT NULL, season TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(scope,id),
 FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id), FOREIGN KEY(scope,item_id) REFERENCES ryo_creator_shop(scope,id)
);
CREATE INDEX IF NOT EXISTS ryo_creator_redemptions_month ON ryo_creator_redemptions(scope,creator_id,item_id,created);
CREATE TABLE IF NOT EXISTS ryo_creator_audit (
 sequence BIGSERIAL PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
 target TEXT NOT NULL, reason TEXT NOT NULL, detail JSONB NOT NULL, created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ryo_creator_audit_scope ON ryo_creator_audit(scope,sequence);
CREATE TABLE IF NOT EXISTS ryo_creator_migrations (
 scope TEXT NOT NULL, id TEXT NOT NULL, creator_id TEXT NOT NULL, old_wallet TEXT NOT NULL, new_wallet TEXT NOT NULL,
 expires BIGINT NOT NULL, accepted BIGINT, created BIGINT NOT NULL, PRIMARY KEY(scope,id),
 FOREIGN KEY(scope,creator_id) REFERENCES ryo_creators(scope,id)
);
