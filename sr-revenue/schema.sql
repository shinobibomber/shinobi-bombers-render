-- SR Revenue Distribution v1: finalized service allocations, separate from token genesis allocations.
CREATE TABLE IF NOT EXISTS ryo_service_revenue (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL,
 product TEXT NOT NULL, total_raw NUMERIC(30,0) NOT NULL CHECK(total_raw>0),
 allocations JSONB NOT NULL, destinations JSONB NOT NULL, config_version INTEGER NOT NULL,
 created BIGINT NOT NULL, PRIMARY KEY(scope,wallet,request_id), UNIQUE(scope,signature),
 FOREIGN KEY(scope,wallet,request_id) REFERENCES ryo_purchases(scope,wallet,request_id)
);
CREATE TABLE IF NOT EXISTS ryo_revenue_replenishments (
 scope TEXT NOT NULL, signature TEXT NOT NULL, source TEXT NOT NULL,
 amount_raw NUMERIC(30,0) NOT NULL CHECK(amount_raw>0), proposal_id TEXT NOT NULL,
 evidence JSONB NOT NULL, created BIGINT NOT NULL,
 PRIMARY KEY(scope,signature), UNIQUE(scope,proposal_id)
);
