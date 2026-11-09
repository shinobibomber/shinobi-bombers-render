# Founder paid-launch preparation — 2026-11-09

The owner approved paid Mainnet launch and the published commercial terms, the existing
poster artwork as clean square NFT crops, and benefit claims inside the game once it
opens. This is owner approval, not a claim of independent legal review. Keep existing
game-access restrictions and release stage. Standalone SOL Sensei sales stay off.

## Verified

- Founder and Sensei recovery require the buyer's signature over the stored message
  and successful finalized status. Paginated recovery leaves uncertain evidence pending.
- The retired Mythic Box recovery no longer accepts account existence as payment.
- Payment regression tests and independent read-only review passed, including the
  plain SOL transfer exploit, expiry, recovery, pagination and idempotency.
- Real Devnet end-to-end passed after the owner funded the disposable test wallet:
  both NFT tiers, exact 1.5 SOL revenue, single-purchase limit, activation, 10 Limited
  summons, and buyer-bound benefits after NFT transfer. Both mints have supply 1,
  decimals 0 and no mint authority. Report: ignored `tests/out/founders-devnet-e2e.json`.
  Mythic transaction: `4VohE4iq7pRUFsdRrKDvhbLG9i9Uzn3isvv7r8Hj9xCqH8Lo89mEbuoH9N59KiosgaFP4J5UW6JbChyNfKhQkfY3`.
  Legacy transaction: `4uBYuFc2GZDwceuEfENvEGmAPNVUFs2C8eymrehYGNyw2reqofCqKUX9w9kWkahREht7C2iaURq6zyk3vDfkV8tf`.
- Approved 800×800 NFT images are prepared at `/founders/art/mythic.png` and
  `/founders/art/legacy.png`. Source posters remain unchanged.

## Remaining activation steps

The preparation commit `64741a23b7f15c8f3fc28d2e6b781f579c5fc772` was deployed and
both live NFT image hashes and metadata URLs verified. Anonymous game API, admin and
game-page restrictions passed. The owner saved a dedicated mint authority in Render;
authenticated API validation confirmed its public address:
`8EfEXodGH52bUC19TNQJ58k8R417d8UCpnTadiD9DdTi`.

The owner authorized the Founder SOL revenue destination:
`6vfgh2RuH3MnbYjpye7Kfc5sJAHgQmMFfGcAw4RrWhXQ`.
No revenue variable was previously configured. The existing private RPC was verified
against the Mainnet genesis hash. Render access was restored with its official CLI
and owner-completed browser authorization; credentials remain in the CLI's local
configuration, outside the repository.

Activation additionally requires the reviewed startup exception in `network/network.cjs`:
the public revenue destination plus a separate Founder key can exist without game
custody, studio or token settings. Adding any game money setting retains the original
complete-private-configuration requirements. This exception stays valid when sales
are paused, and never relaxes the stage, tester allowlist or SR-routing restrictions.

Deploy that tested exception before saving the approved revenue destination and
final switches, then deploy and verify their live behavior. No real Mainnet payment
has been made by this session; the successful payment exercise was on Devnet.

Authorized final settings: public sale **on**, private testing **off**, reward
redemption **on**, standalone SOL Sensei **off**. Until readiness is verified all four
remain **off**. Benefits are claimed in the game when it opens; NFT ownership does
not bypass existing access restrictions.

Rollback: turn public sale off; submitted transactions can still settle. Turn reward
redemption off to pause claims. Prior disabled release:
`6e87d991a80b1493600afa005b544d1ce36f9838`. Initial backup evidence and full-suite
validation are in [the disabled release record](FOUNDERS_DISABLED_RELEASE.md).
