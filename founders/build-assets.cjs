/* Founder's NFT Boxes artwork (run by hand: node founders/build-assets.cjs).
 * founders/assets/source/*.png are the owner's supplied promotional posters, kept byte-for-byte unchanged.
 * This script only writes DERIVED copies: page-size WebP for the pre-landing page (prelaunch/assets/) and NFT
 * images for /founders/art/. The owner approved these clean square poster crops for Mainnet on 2026-11-09. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const SRC = path.join(__dirname, 'assets/source'), PAGE = path.join(__dirname, '../prelaunch/assets'), ART = path.join(__dirname, 'public/art');
(async () => {
  fs.mkdirSync(PAGE, { recursive: true }); fs.mkdirSync(ART, { recursive: true });
  for (const name of ['comparison', 'mythic', 'legacy'])
    await sharp(path.join(SRC, name + '.png')).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 80, effort: 6 }).toFile(path.join(PAGE, 'founders-' + name + '.webp'));
  for (const tier of ['mythic', 'legacy']) {
    await sharp(path.join(SRC, tier + '.png')).resize({ width: 800, height: 800, fit: 'cover', position: 'top' })
      .png({ palette: true, quality: 85, compressionLevel: 9 }).toFile(path.join(ART, tier + '.png'));
  }
  console.log('Founder artwork derived (sources unchanged).');
})().catch(e => { console.error(e); process.exit(1); });
