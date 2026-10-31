# Sensei and fusion update

Sensei now has a saved return threshold: 50%, 60%, 70%, 80%, or 90% chakra. Existing accounts default to 90%. Both browser rotation and authoritative online/offline reward calculation use this setting. On/off is persisted to the account; changing it settles elapsed time under the previous setting first. Enabling Sensei cannot retroactively award time while disabled. The 12-hour offline cap, hire/rental prices and roster limits are unchanged.

| Fusion | Success per attempt | Inputs |
| --- | ---: | --- |
| Genin → Chunin | 90% | 3 Reserve Genin |
| Chunin → Jonin | 80% | 3 Reserve Chunin |
| Jonin → Elite | 70% | 3 Reserve Jonin |
| Elite → Legend | 60% | 3 level 10 Reserve Elites |

Each attempt consumes all three inputs and charges 25,000 Ryo plus the 2% studio fee, including unsuccessful attempts. A failed attempt produces no hero. Batch attempts roll independently and never fuse their own outputs. Batches leave at least two heroes even if all attempts fail.

Server quotes disclose the chance and failure rules. The server generates outcomes once inside purchase reservation, stores the result and resulting profile, and applies them only after finalized settlement. Recovery/retries reuse the stored outcome; they do not roll or charge again. Previously reserved purchases retain their stored outcomes. Old clients must refresh and review the updated quote before submitting a new fusion purchase.

Successful batch outputs use the existing reveal gallery with a success/failure summary. An entirely unsuccessful batch shows a clear result dialog. The Adventure status strip no longer includes the reference's surrounding scenery. The View 3D option and its printed image have been removed from the Adventure Team toolbar.

`apply-gameplay-options.cjs` is applied last by `unpack.cjs`. It includes the server changes and client UI in every clean deployment. No schema migration or environment-variable changes are required.
