import os, sys
from PIL import ImageGrab, ImageStat

# Use workplace dir if provided, fallback to temp
out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'workplace')
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, 'piweb_screenshot.jpg')

try:
    img = ImageGrab.grab()
except Exception as e:
    print(f"ERROR: Screen capture failed (screen may be locked) — {e}", file=sys.stderr)
    sys.exit(1)

# Check for all-black image (locked screen indicator)
stat = ImageStat.Stat(img)
if max(stat.mean) < 1.0:
    print("ERROR: Screen appears locked (all black)", file=sys.stderr)
    sys.exit(1)

w, h = img.size
max_dim = 1280
if w > max_dim or h > max_dim:
    if w > h:
        ratio = max_dim / w
    else:
        ratio = max_dim / h
    img = img.resize((int(w * ratio), int(h * ratio)), 3)

img.save(path, 'JPEG', quality=50)
print(path)
