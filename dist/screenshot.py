import os, tempfile
from PIL import ImageGrab
img = ImageGrab.grab()
w, h = img.size
if w > 1920:
    ratio = 1920 / w
    img = img.resize((1920, int(h * ratio)), 3)
path = os.path.join(tempfile.gettempdir(), 'piweb_screenshot.jpg')
img.save(path, 'JPEG', quality=60)
print(path)
