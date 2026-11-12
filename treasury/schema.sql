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
-- Treasury movements v1 (2026-11-12): verified internal wallet movements that are never revenue or reward funding:
-- treasuryRelocation (former Squads Treasury vault → registered Treasury), burnReserveFunding (Treasury → RYO Burn Reserve)
-- and burn (finalized Token-2022 burn from the Burn Reserve). Recorded only through the two-person admin proposal flow.
CREATE TABLE IF NOT EXISTS ryo_treasury_movements (
 scope TEXT NOT NULL, signature TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('treasuryRelocation','burnReserveFunding','burn')),
 source_address TEXT NOT NULL, destination_address TEXT, mint TEXT NOT NULL,
 amount_raw NUMERIC(30,0) NOT NULL CHECK(amount_raw>0), slot BIGINT NOT NULL, block_time BIGINT,
 proposal_id TEXT NOT NULL, evidence JSONB NOT NULL, created BIGINT NOT NULL,
 commitment TEXT NOT NULL DEFAULT 'finalized' CHECK(commitment='finalized'), migration_id TEXT, leg INTEGER,
 CHECK((kind='burn')=(destination_address IS NULL)), CHECK((kind='treasuryRelocation')=(migration_id IS NOT NULL AND leg IS NOT NULL)),
 PRIMARY KEY(scope,signature), UNIQUE(scope,proposal_id)
);
