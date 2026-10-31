# Original map scenes and interface cleanup

The eight battlefields come directly from maps-design.zip. Lossless WebP files
preserve the supplied PNG pixels. The game displays only the battlefield area;
presentation headers, metadata cards and tile legends are outside the viewport.
The complete field is drawn once, without repeated pillar tiles, color grading,
vignettes, duplicated scenery or stretched perspective.

Actors use source-image coordinates. Each map has its own traced solid props
and non-walkable surfaces. Existing target objects are moved onto the connected
playfield with their HP, reward data and prison state intact. Target count and
economy rules are unchanged. Subtle theme particles respect reduced motion.

The smaller gold status strip ends above the map. Clean live Stage, Enemies and
Session labels replace printed examples over continuous panel interiors. Team
element emblems are complete vector icons with padding inside their cards.
The main-menu balance fits every formatted digit and reserves separate space
for its Ryo label and audio control.

Validation covers eight source-pixel comparisons, full-field render fidelity,
connected collision layouts, target-object/HP/reward retention, actor placement,
banner bounds, complete element-icon bounds, main-menu balances through
999,999,999 Ryo, camera/bulk control hit targets, mobile layout and browser errors.
All fifteen build helpers are also applied to a fresh source archive.
