"""Builds a fake-camera video of a hand gesture, for testing photo reminders in the kiosk (kiosk-photo.cjs).

python3 make-hand.py <image.jpg>  ->  out/hand.y4m   (requires Pillow and ffmpeg)
A public sample: storage.googleapis.com/mediapipe-tasks/gesture_recognizer/thumbs_up.jpg (+ ?gesture=Thumb_Up in the test).
"""
import os
import subprocess
import sys

from PIL import Image

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(out, exist_ok=True)
bg = Image.new("RGB", (1280, 720), (200, 195, 185))
bg.paste(Image.open(sys.argv[1]).convert("RGB").resize((640, 640)), (320, 40))
png = os.path.join(out, "hand.png")
bg.save(png)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "3", "-r", "10",
                "-pix_fmt", "yuv420p", os.path.join(out, "hand.y4m")], check=True)
print("out/hand.y4m ready")
