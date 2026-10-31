# Original enemy and boss models

EnemyModel.png and BossModel.png are unchanged originals from the uploaded
Enemy and Boss Model ZIP. Explicit crop coordinates select sixteen enemy
archetypes and six bosses without including headings or card borders.
Their original direction/example animation cells supply the rendered poses.
Alpha cleanup preserves dark costume interiors and source RGB values.

Enemy appearance cycles by stage and existing enemy kind; Boss Hunt stage
selects one of the six bosses. Adventure commanders select the same boss cycle
at stages 25, 50, and so on. Commanders and ordinary prison rescues share kind 6
internally: the explicit boss flag selects a boss first, while non-boss prisons
remain player models. Only rescue figures receive the prison cage overlay.

Both shared enemy/boss renderer APIs are updated. Existing hit and defeat
visual events select the provided example poses. Hit-flash caches include the
model identity so a new stage cannot reuse another archetype's silhouette.
Health, rewards, damage, enemy spawning, prison drops and saved data are unchanged.
