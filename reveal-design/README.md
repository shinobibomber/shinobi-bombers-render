# Reveal presentation

The PNG is an unchanged original from reveal-design.zip. The original header,
footer and card ornaments supply the presentation. Sample heroes, sample NEW
badges and the printed sample count are replaced by the actual saved reveal
batch. Each visible portrait uses the shared player renderer and its tier aura.
The class emblem/name, stars and tier badge come from corresponding original
card crops; the owned hero's name remains in its accessible label and tooltip.

The ten-column reference composition scales as one scene. Batches larger than
ten scroll horizontally; smaller batches never display fake sample heroes.
Unrevealed cards keep a sealed face, and NEW is shown only for an explicit
isNew field supplied by the actual record.

Individual Reveal, Reveal All, reveal order, persistence, and Continue keep
the existing Experience handlers. The legacy spotlight/group overlays are
suppressed only while this design is active so cards stay in the reference
gallery. Summon, Fusion and prison rescue batches retain their real source
headings and destinations. The helper is idempotent and rejects source drift.
