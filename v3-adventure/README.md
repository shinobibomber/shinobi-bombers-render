# Native-grid environment adapter

This V3 slice renders eight environment themes from the existing `G` grid. It does not import illustrated boards as floors or turn screenshot labels into collision/hazard data. Ground and stone details are code-native art, intentionally distinct from finished production tile atlases.

`apply-v3-adventure.cjs` must run after `apply-map-design.cjs`. It appends the renderer and installs a guard in the generated old adapter so its `alignGrid()` cannot replace native topology. The original adapter source and approved map artwork remain preserved for reference/rollback. The early `V3Adventure.preserveNativeGrid` flag exists before asynchronous map callbacks run. `ShinobiSprites.ready` continues to gate final startup.

The adapter changes projection, floor rendering, solid-wall rendering and low-intensity ambient particles only. It does not modify `newMap`, `think`, `boom`, `free`, BFS, rewards, hero stats, inventory, saved stages, database logic or wallet code. Eight theme names come from the approved pack; underlying stage progression still cycles through its existing theme selection.

Actual world dimensions remain31×17 tiles at40world units per tile. Rendering compresses vertical coordinates to fit the existing Adventure HUD; sprite foot anchors and solids use the same projection. Collision is always `G`, not the artwork. No lava damage, ice sliding, pushing, curse spreading, teleporting, spike damage or new AI is introduced.

## Honest asset and gameplay limits

- The supplied map boards include finished scenery and legends, not separable production floor/wall/breakable atlases. These code-rendered materials are an honest fallback while that art is produced; this is not a claim of pixel-identical concept-map recreation.
- Existing target objects are still rendered as the game's enemy models. The current active combat wrapper is ranged projectile combat against stationary grid targets, although the earlier base retains `blast()` and classic bomb primitives. This adapter preserves the active behavior. Restoring a classic bomb-placement mode or adding moving enemies requires separately reviewed game systems work.
- The authoritative Ryo server uses its existing aggregate combat calculation. This visual adapter does not attempt to submit client kills or map state to the server.
- The legacy adapter skips all eight full-scene WebP downloads while this native renderer is installed. It also leaves the earlier tile renderer intact until V3 readiness completes, avoiding a startup race with missing picture images. Source artwork stays preserved for reference/rollback.

## Verification

Run `tools/test-v3-native-adventure.cjs` from the workspace with Playwright available. The isolated browser test uses a simulated wallet and ledger, not real token transactions. It verifies all eight themes retain120native odd/odd solid cells, every `G` object and target value survives renderer calls, source screenshots are never drawn to the playable floor, movement/BFS obey solid cells, the retained `blast()` stops at walls/breakables, active ranged attacks still consume chakra and clear their target, and desktop/mobile/reduced-motion rendering completes without errors.

To roll back this slice, remove the helper call and rebuild from the verified base, or redeploy the pre-V3 source commit. Do not manually mutate a player's save or copy screenshot collision masks into it.
