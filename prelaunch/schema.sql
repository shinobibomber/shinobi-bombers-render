-- Pre-launch players v1: registered accounts (internal player id, unique username, preferences).
-- Keyed like every game table on (scope, wallet), so registrations carry into the live game unchanged.
CREATE TABLE IF NOT EXISTS ryo_players (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, player_id UUID NOT NULL,
 username TEXT NOT NULL, username_key TEXT NOT NULL,
 language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','pt-BR')),
 region TEXT NOT NULL DEFAULT 'asia' CHECK(region IN ('asia','south-america')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 leaderboard_visible BOOLEAN NOT NULL DEFAULT TRUE,
 created BIGINT NOT NULL, last_login BIGINT NOT NULL,
 PRIMARY KEY(scope,wallet), UNIQUE(scope,player_id), UNIQUE(scope,username_key),
 CHECK(username ~ '^[A-Za-z0-9_]{3,16}$'), CHECK(username_key = lower(username))
);
CREATE INDEX IF NOT EXISTS ryo_player_referrals_referrer ON ryo_player_referrals(scope,referrer);
