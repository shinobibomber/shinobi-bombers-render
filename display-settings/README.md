# Display & Accessibility

Open it from **Tools (⚙) → Display & Accessibility** — the same header on the Main Menu and in game.
Presentation only: damage, hitboxes, movement, timers, rewards and server logic never change.

| Setting | Default (Comfort) | What it controls |
|---|---|---|
| Preset | Comfort | Comfort / Minimal effects / Standard; any change shows "Custom" |
| Brightness | 65% | CSS filter on the game scene canvases only (`#cv`, `#bossHuntMap`, overlay mirrors); 100% = original |
| Explosion effects | Reduced | Full / Reduced (smaller, softer bursts) / Off (no burst; an outlined marker on the hit tile and an ultimate's 4 neighbours) |
| Flashing lights | Off | Enemy white hit flash softened; summon celebration flash, rarity flash and overlay flashes removed |
| Screen shake | Off | Arena camera shake and overlay shake animations |
| Reduce motion | On | Falling petals, fx layers, ambient motes, aura animation (tier and Mythic), overlay transitions |
| Bloom & glow | Off | Glow particles dimmed, neon card pulses removed |
| High contrast | Off | Scene contrast, stronger outlines/text, thicker Boss Hunt danger telegraph |
| Colorblind-friendly | Off | Patterned bars, dashed markers, "⚠" on the Boss Hunt shockwave |

The effects level also feeds the game's existing `Arena3D.setFx` (0 off / 1 reduced / 2 full), which
already drives particle counts, weather and aura animation. Gameplay-critical visuals (projectiles,
enemies, HP, tile markers, the shockwave telegraph) are shown in every preset.

Saved instantly in the browser (`localStorage['sb-display-v1']`, validated; invalid values fall back
to Comfort) and synced to the signed-in account (`profile.display`, action `display-settings`); the
newest copy wins, so settings follow the player to another device. Reset to default returns to Comfort.
