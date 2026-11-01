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

# scr-heroes-game.webp: the Heroes screen with the shared header used by the other menus (taken from the Guild
# screen, with Guild un-highlighted from the Fusion header and Heroes highlighted), so the header matches everywhere.
heroes = cv2.imread(str(root / 'website/assets/scr-heroes.webp')).astype(np.float32)
guild = cv2.imread(str(root / 'website/assets/scr-guild.webp')).astype(np.float32)
fusion = cv2.imread(str(root / 'website/assets/scr-fusion.webp')).astype(np.float32)
hdr = guild[:122].copy()
hdr[0:88, 968:1072] = fusion[0:88, 972:1076]                     # Guild item without its highlight
x0h, x1h = 306, 392                                                # Heroes item: purple highlight like the others
cell = hdr[0:88, x0h:x1h]
yy = np.linspace(0, 1, 88)[:, None, None]
purple = np.array([235, 40, 120], np.float32) * (1 - yy) + np.array([150, 20, 70], np.float32) * yy   # BGR gradient
lit = 255 - (255 - cell) * (255 - purple * .85) / 255                # screen blend keeps the white icon/label
lit[-4:] = np.array([255, 120, 200], np.float32)                   # bright bottom edge
lit[:, :2] = lit[:, -2:] = np.array([200, 70, 150], np.float32)
hdr[0:88, x0h:x1h] = lit
alpha = np.ones((122, 1, 1), np.float32); alpha[96:] = np.linspace(1, 0, 26)[:, None, None]   # blend into scenery
heroes[:122] = hdr * alpha + heroes[:122] * (1 - alpha)
cv2.imwrite(str(root / 'website-design/scr-heroes-game.webp'), heroes.clip(0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 90])
print('heroes header ->', 'website-design/scr-heroes-game.webp')
