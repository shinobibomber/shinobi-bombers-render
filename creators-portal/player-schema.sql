-- Player Referrals v1: signed-wallet invitations and two claimable standard hero passes.
CREATE TABLE IF NOT EXISTS ryo_player_referrers (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, code TEXT NOT NULL, created BIGINT NOT NULL,
 PRIMARY KEY(scope,wallet), UNIQUE(scope,code)
);
CREATE TABLE IF NOT EXISTS ryo_player_referrals (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, referrer TEXT NOT NULL, attributed BIGINT NOT NULL,
 paid_mints INTEGER NOT NULL DEFAULT 0 CHECK(paid_mints>=0), stage5 BIGINT,
 proof JSONB NOT NULL DEFAULT '{}', qualified BIGINT,
 PRIMARY KEY(scope,wallet), FOREIGN KEY(scope,referrer) REFERENCES ryo_player_referrers(scope,wallet),
 CHECK(wallet<>referrer)
);
CREATE INDEX IF NOT EXISTS ryo_player_referrals_owner ON ryo_player_referrals(scope,referrer,attributed);
CREATE TABLE IF NOT EXISTS ryo_player_referral_rewards (
 scope TEXT NOT NULL, referral_wallet TEXT NOT NULL, wallet TEXT NOT NULL,
 passes INTEGER NOT NULL DEFAULT 2 CHECK(passes=2), claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed BETWEEN 0 AND 2),
 created BIGINT NOT NULL, PRIMARY KEY(scope,referral_wallet),
 FOREIGN KEY(scope,referral_wallet) REFERENCES ryo_player_referrals(scope,wallet),
 FOREIGN KEY(scope,wallet) REFERENCES ryo_player_referrers(scope,wallet)
);
CREATE INDEX IF NOT EXISTS ryo_player_rewards_owner ON ryo_player_referral_rewards(scope,wallet,created);
CREATE TABLE IF NOT EXISTS ryo_player_referral_claims (
 scope TEXT NOT NULL, id TEXT NOT NULL, wallet TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity IN (1,2)),
 result JSONB NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(scope,id),
 FOREIGN KEY(scope,wallet) REFERENCES ryo_player_referrers(scope,wallet)
);
