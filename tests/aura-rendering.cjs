/* Aura pixels, cache limits and quality switches; no gameplay or transactions. */
const fs = require('node:fs'), path = require('node:path');
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, errors, assert }) => {
    await p.waitForFunction(() => window.TierAuras?.loaded);
    const result = await p.evaluate(() => {
      const originalQuality = Arena3D.cfg.fx, sizes = [], checks = [], sheet = document.createElement('canvas');
      sheet.width = 960; sheet.height = 440;
      const painter = sheet.getContext('2d'); painter.fillStyle = '#101529'; painter.fillRect(0, 0, sheet.width, sheet.height);
      const hash = image => {
        const d = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        let result = 2166136261, visible = 0, edge = 0, smooth = 0;
        for (let i = 0; i < d.length; i++) result = Math.imul(result ^ d[i], 16777619);
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const alpha = d[(y * image.width + x) * 4 + 3];
          if (alpha) { visible++; if (alpha < 255) smooth++; if (!x || !y || x === image.width - 1 || y === image.height - 1) edge++; }
        }
        return { hash: result, visible, edge, smooth };
      };
      try {
        Arena3D.setFx(2);
        for (const rank of [3, 4]) {
          const frames = [0, 420, 840].map(time => TierAuras.animatedFrame(rank, time));
          const body = PlayerModels.heroFrame({ id: 0, r: rank }, 'i0');
          for (let i = 0; i < frames.length; i++) {
            painter.drawImage(frames[i], i * 320 + 80, (rank - 3) * 220, 160, 200);
            painter.drawImage(body, i * 320 + 80, (rank - 3) * 220, 160, 200);
            painter.fillStyle = '#fff'; painter.font = '14px sans-serif';
            painter.fillText((rank === 3 ? 'Elite' : 'Legend') + ' / phase ' + i, i * 320 + 90, (rank - 3) * 220 + 215);
          }
          checks.push({ rank, hashes: frames.map(hash), source: hash(TierAuras.frame(rank)) });
        }
        for (let rank = 0; rank < 5; rank++) for (let phase = 0; phase < 96; phase++) {
          const frame = TierAuras.animatedFrame(rank, phase * 2000 / 24);
          sizes.push([frame.width, frame.height]);
        }
        const count = TierAuras.animationFrames;
        const oldRead = CanvasRenderingContext2D.prototype.getImageData, oldDraw = CanvasRenderingContext2D.prototype.drawImage;
        let reads = 0, draws = 0;
        CanvasRenderingContext2D.prototype.getImageData = function (...args) { reads++; return oldRead.apply(this, args); };
        CanvasRenderingContext2D.prototype.drawImage = function (...args) { draws++; return oldDraw.apply(this, args); };
        try { for (let n = 0; n < 300; n++) TierAuras.animatedFrame(3 + n % 2, n * 83.333); }
        finally { CanvasRenderingContext2D.prototype.getImageData = oldRead; CanvasRenderingContext2D.prototype.drawImage = oldDraw; }
        const low = [0, 1, 2].every(rank => TierAuras.animatedFrame(rank, 0) !== TierAuras.animatedFrame(rank, 600));
        const fronts = [0, 1, 2, 3, 4].map(rank => hash(TierAuras.animatedFront(rank, 0)));
        Arena3D.setFx(0);
        const disabled = [0, 1, 2, 3, 4].every(rank => TierAuras.animatedFrame(rank, 200) === TierAuras.frame(rank) && TierAuras.animatedFront(rank, 200) === TierAuras.front(rank));
        // Aura colors follow rarity even when exactly the same Fire body is used.
        const body = PlayerModels.heroFrame({ id: 0, r: 0 }, 'i0');
        const elite = TierAuras.compose({ id: 0, r: 3 }, body), legend = TierAuras.compose({ id: 0, r: 4 }, body);
        const state = { eliteRank: elite.tierAura.rank, legendRank: legend.tierAura.rank,
          sameBody: elite.tierAuraBase === body && legend.tierAuraBase === body,
          model: elite.playerModel.model };
        Arena3D.setFx(2);
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 400;
        const context = canvas.getContext('2d'); context.globalAlpha = .4;
        context.translate(7, 9); const before = context.getTransform().toString();
        ShinobiSprites.blit(context, elite, 160, 352, 8, true, .6);
        return { checks, count, maximum: TierAuras.maxAnimationFrames, sizes, reads, draws, low, fronts, disabled, state,
          context: { alpha: context.globalAlpha, transform: context.getTransform().toString() === before }, image: sheet.toDataURL() };
      } finally { Arena3D.setFx(originalQuality); }
    });
    for (const row of result.checks) {
      assert.equal(new Set(row.hashes.map(x => x.hash)).size, 3, 'Elite/Legend phases change real aura pixels');
      for (const image of [...row.hashes, row.source]) {
        assert(image.visible > 1000); assert(image.smooth > 500, 'luminous edges retain antialiased alpha');
        assert.equal(image.edge, 0, 'aura stays within its surface without clipped hard edges');
      }
    }
    assert(result.count <= result.maximum && result.maximum === 80);
    for (const image of result.fronts) { assert(image.visible > 200, 'every rarity has foreground particles'); assert.equal(image.edge, 0, 'particles stay inside the frame'); }
    assert.equal(result.reads, 0); assert.equal(result.draws, 0, 'warmed phases reuse surfaces without repaint');
    assert(result.low, 'every rarity aura animates'); assert(result.disabled, 'effects off shows the still aura');
    assert.deepEqual(result.state, { eliteRank: 3, legendRank: 4, sameBody: true, model: 0 });
    assert.equal(result.context.transform, true); assert(Math.abs(result.context.alpha - .4) < 1e-6);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await p.evaluate(() => [0, 1, 2, 3, 4].every(rank => TierAuras.animatedFrame(rank, 200) === TierAuras.frame(rank))), true);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    assert.deepEqual(errors, []);
    const output = path.join(__dirname, 'out'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'elite-legend-aura-phases.png'), Buffer.from(result.image.split(',')[1], 'base64'));
    console.log('PASS: animated Elite/Legend aura pixels, smooth unclipped edges, 80-frame bound, all rarities animated with foreground particles, zero warm redraw/readback, native body identity and quality/reduced-motion switches.');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
