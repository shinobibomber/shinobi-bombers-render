-- Treasury integration v1: live 5% withdrawal deduction ledger and claim-cadence index. Additive and idempotent.
ALTER TABLE ryo_withdrawals ADD COLUMN IF NOT EXISTS treasury_fee_raw NUMERIC(30,0) NOT NULL DEFAULT 0;
ALTER TABLE ryo_withdrawals ADD COLUMN IF NOT EXISTS net_raw NUMERIC(30,0);
ALTER TABLE ryo_withdrawals ADD COLUMN IF NOT EXISTS treasury_fee_destination TEXT;
CREATE TABLE IF NOT EXISTS ryo_withdrawal_treasury_fees (
 scope TEXT NOT NULL, wallet TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL,
 gross_raw NUMERIC(30,0) NOT NULL CHECK(gross_raw>0), fee_raw NUMERIC(30,0) NOT NULL CHECK(fee_raw>0),
 net_raw NUMERIC(30,0) NOT NULL CHECK(net_raw>0), destination TEXT NOT NULL, created BIGINT NOT NULL,
 CHECK(fee_raw+net_raw=gross_raw), PRIMARY KEY(scope,wallet,request_id), UNIQUE(scope,signature),
 FOREIGN KEY(scope,wallet,request_id) REFERENCES ryo_withdrawals(scope,wallet,request_id)
);
CREATE INDEX IF NOT EXISTS ryo_reward_claims_wallet ON ryo_reward_claims(scope,wallet,created);
-- Read-only monitoring log of finalized Chapter 04 destination balances (admin dashboard drift alerts).
CREATE TABLE IF NOT EXISTS ryo_treasury_observations (
 scope TEXT NOT NULL, role TEXT NOT NULL, address TEXT NOT NULL, sol_lamports NUMERIC(30,0), sr_raw NUMERIC(30,0),
 status TEXT NOT NULL, observed BIGINT NOT NULL, PRIMARY KEY(scope,role,observed)
);
