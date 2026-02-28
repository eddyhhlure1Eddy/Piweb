#!/usr/bin/env python3
"""Screenshot tool for Linux (Raspberry Pi / Wayland+Xwayland).
Tries grim (Wayland-native) -> scrot (X11) -> PIL ImageGrab as fallback.
"""
import os, sys, subprocess, shutil
from PIL import Image, ImageStat

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'workplace')
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, 'piweb_screenshot.jpg')
temp_png = os.path.join(out_dir, 'temp_screenshot.png')
img = None

# --- Method 1: grim (native Wayland, best for labwc) ---
if shutil.which('grim'):
    try:
        subprocess.run(['grim', temp_png], check=True, timeout=10,
                       capture_output=True)
        img = Image.open(temp_png)
    except Exception:
        img = None

# --- Method 2: scrot (X11 via Xwayland) ---
if img is None and shutil.which('scrot'):
    env = os.environ.copy()
    if not env.get('DISPLAY'):
        env['DISPLAY'] = ':0'
    try:
        subprocess.run(['scrot', '-z', temp_png], check=True, timeout=10,
                       capture_output=True, env=env)
        img = Image.open(temp_png)
    except Exception:
        img = None

# --- Method 3: PIL ImageGrab (Linux needs pyscreenshot or X11) ---
if img is None:
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab()
    except Exception as e:
        print(f"ERROR: All screenshot methods failed — {e}", file=sys.stderr)
        sys.exit(1)

# Clean up temp
if os.path.exists(temp_png):
    os.remove(temp_png)

# Check for blank screen
stat = ImageStat.Stat(img)
if max(stat.mean) < 1.0:
    print("ERROR: Screen appears locked or blank (all black)", file=sys.stderr)
    sys.exit(1)

# Resize if needed (max 1280px)
w, h = img.size
max_dim = 1280
if w > max_dim or h > max_dim:
    ratio = max_dim / max(w, h)
    img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)

img.save(path, 'JPEG', quality=50, optimize=True)
print(path)
