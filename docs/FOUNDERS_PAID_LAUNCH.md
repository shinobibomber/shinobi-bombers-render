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

1. Deploy the reviewed preparation update and verify both public NFT URLs.
2. Install a dedicated Mainnet mint authority securely in the live Render service.
   No Mainnet key has been generated in this session. Browser automation and the
   secure Node tool were unavailable; never paste a secret into chat. If no authority
   exists, `powershell -NoProfile -File tools/founders-authority-clipboard.ps1` generates
   a new key locally and puts its secret only in the clipboard for the Render
   `FOUNDERS_MINT_AUTHORITY_SECRET` field. Clear the clipboard after saving. Do not
   use this helper to replace an existing configured authority.
3. Verify live Mainnet RPC, existing revenue destination, deployed commit, purchase
   readiness and game-access restrictions. Restore the Render connection, which
   became unavailable during this session. No real Mainnet payment has been made.

Authorized final settings: public sale **on**, private testing **off**, reward
redemption **on**, standalone SOL Sensei **off**. Until readiness is verified all four
remain **off**. Benefits are claimed in the game when it opens; NFT ownership does
not bypass existing access restrictions.

Rollback: turn public sale off; submitted transactions can still settle. Turn reward
redemption off to pause claims. Prior disabled release:
`6e87d991a80b1493600afa005b544d1ce36f9838`. Initial backup evidence and full-suite
validation are in [the disabled release record](FOUNDERS_DISABLED_RELEASE.md).
