#!/usr/bin/env python3
"""Generate a 1024x1024 app icon (squircle + play/spark motif) for Content Engine."""
import os
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-rect (squircle-ish) background with a vertical gradient.
radius = int(S * 0.225)
top = (124, 58, 237)     # violet-600
bot = (37, 99, 235)      # blue-600
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# White play triangle (the "content" / video cue), centered.
cx, cy = S * 0.52, S * 0.5
w = S * 0.30
h = S * 0.34
tri = [(cx - w / 2, cy - h / 2), (cx - w / 2, cy + h / 2), (cx + w / 2, cy)]
d.polygon(tri, fill=(255, 255, 255, 240))

# Small sparks (the "engine"/AI cue) top-left of the triangle.
def star(ox, oy, r):
    pts = []
    import math
    for i in range(8):
        ang = math.pi / 4 * i
        rr = r if i % 2 == 0 else r * 0.4
        pts.append((ox + rr * math.cos(ang), oy + rr * math.sin(ang)))
    d.polygon(pts, fill=(255, 255, 255, 235))

star(S * 0.30, S * 0.28, S * 0.05)
star(S * 0.24, S * 0.40, S * 0.028)

out = os.path.join(os.path.dirname(__file__), "icon-1024.png")
img.save(out)
print(out)
