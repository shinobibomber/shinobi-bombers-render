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
