/* Preserve full-scene artwork while avoiding identical native floor rebuilds. */
const { withGame } = require('./harness.cjs');

(async () => {
  await withGame(async ({ p, f, errors, assert }) => {
    f.holdAdventure = false;
    await p.locator('#loginPhantom').click();
    await p.waitForFunction(() => RyoPayments.state.authenticated && !RyoPayments.state.busy &&
      !LoginScreen.active && window.MapDesign?.loaded);
    const rows = await p.evaluate(async () => {
      const state = () => JSON.stringify({ heroes: S.h, grid: G, map: S.map, balance: RyoPayments.state.balance });
      const images = await Promise.all(MapDesign.maps.map(async entry => {
        const image = new Image(); image.src = new URL('assets/map-design/' + entry.file, location.href).href;
        await image.decode(); return image;
      }));
      const before = state(), canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
      const reference = document.createElement('canvas'); reference.width = W * T; reference.height = 465;
      const expected = reference.getContext('2d', { willReadFrequently: true });
      expected.imageSmoothingEnabled = true; expected.imageSmoothingQuality = 'high';
      let draws = 0;
      const originalDraw = context.drawImage.bind(context);
      context.drawImage = (...args) => { draws++; return originalDraw(...args); };
      const checks = [];
      for (let map = 1; map <= 8; map++) {
        const startingDraws = draws;
        MapDesign.drawFloor(canvas, { W, T, map });
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        expected.drawImage(images[map - 1], 0, 70, 1536, 575, 0, 0, reference.width, reference.height);
        const source = expected.getImageData(0, 0, reference.width, reference.height).data;
        let changed = 0, transparent = 0;
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== source[i]) changed++;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) transparent++;
        // Rebuilds caused by tilt changes or the next stage in an eight-map
        // rotation must not reset/repaint identical original scenery.
        for (let i = 0; i < 30; i++) MapDesign.drawFloor(canvas, { W, T, map: map + i % 2 * 8, G: [] });
        checks.push({ map, changed, transparent, draws: draws - startingDraws, label: canvas.dataset.originalMap });
      }
      const sameMap = 8, lastDraws = draws;
      MapDesign.drawFloor(canvas, { W: W + 1, T, map: sameMap });
      const resized = canvas.width === (W + 1) * T && draws === lastDraws + 1;
      // External resize loses pixels; the next call must restore its required size.
      canvas.width = 1;
      MapDesign.drawFloor(canvas, { W, T, map: sameMap });
      const restored = canvas.width === W * T && canvas.height === 465;
      const second = document.createElement('canvas');
      MapDesign.drawFloor(second, { W, T, map: sameMap });
      const independent = second.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 255;
      return { checks, resized, restored, independent, unchanged: before === state() };
    });
    assert.equal(rows.checks.length, 8);
    for (const row of rows.checks) {
      assert.equal(row.changed, 0, 'map ' + row.map + ': every rendered channel matches original high-quality scaling');
      assert.equal(row.transparent, 0, 'map ' + row.map + ': no missing pixels or transparent seams');
      assert.equal(row.draws, 1, 'map ' + row.map + ': identical rebuilds reuse the native backing pixels');
      assert.equal(row.label, String(row.map));
    }
    assert(rows.resized && rows.restored && rows.independent, 'dimensions and different canvas owners invalidate independently');
    assert(rows.unchanged, 'rendering leaves the map, collisions, heroes and ledger unchanged');
    assert.deepEqual(errors, []);
    assert.equal(f.purchases.length, 0);
  });
  console.log('PASS: all eight original maps remain pixel-exact, opaque and aligned; identical floor rebuilds perform zero redraws.');
})().catch(error => { console.error(error); process.exitCode = 1; });
