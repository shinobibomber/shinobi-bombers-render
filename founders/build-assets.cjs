/* Founder's NFT Boxes artwork (run by hand: node founders/build-assets.cjs).
 * founders/assets/source/*.png are the owner's supplied promotional posters, kept byte-for-byte unchanged.
 * This script only writes DERIVED copies: page-size WebP for the pre-landing page (prelaunch/assets/) and NFT
 * images for /founders/art/. Until final NFT artwork is approved, the NFT images are visibly labelled
 * "DEVNET TEST ART" so they can never be mistaken for the approved Mainnet artwork. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const SRC = path.join(__dirname, 'assets/source'), PAGE = path.join(__dirname, '../prelaunch/assets'), ART = path.join(__dirname, 'public/art');
(async () => {
  fs.mkdirSync(PAGE, { recursive: true }); fs.mkdirSync(ART, { recursive: true });
  for (const name of ['comparison', 'mythic', 'legacy'])
    await sharp(path.join(SRC, name + '.png')).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 80, effort: 6 }).toFile(path.join(PAGE, 'founders-' + name + '.webp'));
  for (const tier of ['mythic', 'legacy']) {
    const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="96"><rect width="800" height="96" fill="#000" fill-opacity=".72"/><text x="400" y="66" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#ffcf4a" text-anchor="middle">DEVNET TEST ART</text></svg>');
    await sharp(path.join(SRC, tier + '.png')).resize({ width: 800, height: 800, fit: 'cover', position: 'top' })
      .composite([{ input: label, gravity: 'south' }]).png({ palette: true, quality: 85, compressionLevel: 9 }).toFile(path.join(ART, tier + '.png'));
  }
  console.log('Founder artwork derived (sources unchanged).');
})().catch(e => { console.error(e); process.exit(1); });
