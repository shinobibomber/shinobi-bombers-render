/* Website ↔ game connection.
 *
 * gameUrl
 *   ""                          → preview mode: the website shows its demo values (as before) and no game is connected.
 *   "/play/"                    → the game is served from this same origin by server/site-server.cjs (set automatically there).
 *   "https://game.example.com/" → the game runs on its own origin (recommended by the transfer package).
 *     Replace with your real game URL; the example domain is a placeholder.
 * embedPreview
 *   true  → the #play page offers an optional in-page preview (wallet sign-in inside a frame is NOT verified).
 *   false → full-page link only.
 *
 * When the site is served by server/site-server.cjs, this file is replaced by one generated from the GAME_URL and
 * GAME_EMBED_PREVIEW environment variables. Never put keys, secrets or session tokens here.
 */
window.SB_SITE_CONFIG = { gameUrl: "", embedPreview: true };
