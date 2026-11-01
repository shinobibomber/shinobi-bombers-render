"""Builds small artwork patches used by website-design/ inside the game (/play/).

adventure-tr-patch.webp: the Adventure screen's top-right "Difficulty / Stage Info" box removed (the game has no
difficulty setting) by inpainting that rectangle from the surrounding scenery of website/assets/scr-adventure.webp.
Usage: python3 website-src/make_game_patches.py
"""
import cv2, numpy as np, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / 'website/assets/scr-adventure.webp'))
x0, y0, x1, y1 = 1150, 128, 1536, 236          # patch rectangle (screen coordinates)
bx0, by0, bx1, by1 = 1196, 148, 1526, 226      # box to remove
mask = np.zeros(img.shape[:2], np.uint8); mask[by0:by1, bx0:bx1] = 255
out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)
# soften the filled area slightly so it reads as distant scenery
blur = cv2.GaussianBlur(out, (0, 0), 3.0)
m3 = cv2.GaussianBlur(mask, (0, 0), 6.0).astype(np.float32)[..., None] / 255.0
out = (out * (1 - m3) + blur * m3).astype(np.uint8)
patch = out[y0:y1, x0:x1]
cv2.imwrite(str(root / 'website-design/adventure-tr-patch.webp'), patch, [cv2.IMWRITE_WEBP_QUALITY, 92])
print('patch', patch.shape, '->', 'website-design/adventure-tr-patch.webp')

# shared-header.webp: ONE header used on every website screen inside the game (fixed at the top, identical on all
# menus). It is the Guild screen's header with Guild un-highlighted (that cell taken from the Fusion header); the
# active menu is highlighted at runtime. Bottom rows fade out (alpha) into each screen's scenery.
guild = cv2.imread(str(root / 'website/assets/scr-guild.webp'))
fusion = cv2.imread(str(root / 'website/assets/scr-fusion.webp'))
hdr = guild[:124].copy()
hdr[0:88, 968:1072] = fusion[0:88, 972:1076]
a = np.full(hdr.shape[:2], 255, np.uint8); a[112:] = np.linspace(255, 0, 12).astype(np.uint8)[:, None]
cv2.imwrite(str(root / 'website-design/shared-header.webp'), np.dstack([hdr, a]), [cv2.IMWRITE_WEBP_QUALITY, 95])
print('shared header ->', 'website-design/shared-header.webp')

# dojo views: the Dojo artwork holds three panels (Services, Upgrades, Sensei). Each becomes its own page
# (website-design/dojo-views.json): panels are scaled to the page width over a blurred, darkened backdrop.
import json
views = json.load(open(root / 'website-design/dojo-views.json'))
dojo = cv2.imread(str(root / 'website/assets/scr-dojo.webp'))
for key, v in views.items():
    W, H = v['W'], v['H']
    if 'ref' in v:
        # reference design page: example values are inpainted away (live values are drawn at runtime)
        img = cv2.imread(str(root / v['ref']))
        if 'ringcopy' in v:
            # an example highlight frame is replaced by the plain frame of the row below it (dy pixels lower)
            x0, y0, x1, y1, t, dy = v['ringcopy']; ring = np.zeros(img.shape[:2], bool); ring[y0:y1, x0:x1] = True; ring[y0 + t:y1 - t, x0 + t:x1 - t] = False
            src = np.roll(img, -dy, axis=0); img[ring] = src[ring]
        mask = np.zeros(img.shape[:2], np.uint8)
        for x, y, w, h in v.get('clean', []): mask[y:y + h, x:x + w] = 255
        if 'ring' in v:
            x0, y0, x1, y1, t = v['ring']; ring = np.zeros_like(mask); ring[y0:y1, x0:x1] = 255; ring[y0 + t:y1 - t, x0 + t:x1 - t] = 0; mask |= ring
        img = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA)
        cv2.imwrite(str(root / f'website-design/scr-{key}.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 92])
        print(key, '-> website-design/scr-%s.webp (reference design)' % key)
        continue
    bg = cv2.resize(dojo, (W, H), interpolation=cv2.INTER_AREA)
    bg = (cv2.GaussianBlur(bg, (0, 0), 14) * 0.45).astype(np.uint8)
    for pnl in v['panels']:
        x0, y0, x1, y1 = pnl['src']; k = W / (pnl['src'][2] - pnl['src'][0]) if key != 'dojo-sen' else 1536 / 1167
        crop = dojo[y0:y1, x0:x1]
        out = cv2.resize(crop, (round((x1 - x0) * k), round((y1 - y0) * k)), interpolation=cv2.INTER_LANCZOS4)
        sharp = cv2.addWeighted(out, 1.35, cv2.GaussianBlur(out, (0, 0), 1.2), -0.35, 0)
        dx, dy = pnl['dst']; h, w = sharp.shape[:2]; h = min(h, H - dy); w = min(w, W - dx)
        bg[dy:dy + h, dx:dx + w] = sharp[:h, :w]
        pnl['k'] = k
    cv2.imwrite(str(root / f'website-design/scr-{key}.webp'), bg, [cv2.IMWRITE_WEBP_QUALITY, 90])
    print(key, '->', f'website-design/scr-{key}.webp')
json.dump(views, open(root / 'website-design/dojo-views.json', 'w'), indent=1)
