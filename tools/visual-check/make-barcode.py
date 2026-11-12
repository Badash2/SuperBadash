"""Builds a fake-camera video showing an EAN-13 barcode (Bamba 7290000066318) for testing the scanner.

python3 make-barcode.py  ->  out/barcode.y4m   (requires Pillow and ffmpeg)
"""
import os
import subprocess

from PIL import Image, ImageDraw

CODE = os.environ.get("CODE", "7290000066318")
L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

d = [int(c) for c in CODE]
par = PARITY[d[0]]
bits = "101" + "".join((L if par[i] == "L" else G)[d[i + 1]] for i in range(6)) + "01010" + "".join(R[x] for x in d[7:]) + "101"

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(out, exist_ok=True)
W, H, m = 1280, 720, 6
im = Image.new("RGB", (W, H), (235, 230, 220))
dr = ImageDraw.Draw(im)
x0 = (W - len(bits) * m) // 2
dr.rectangle([x0 - 60, 200, x0 + len(bits) * m + 60, 520], fill="white")
for i, b in enumerate(bits):
    if b == "1":
        dr.rectangle([x0 + i * m, 230, x0 + i * m + m - 1, 480], fill="black")
png = os.path.join(out, "barcode.png")
im.save(png)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "3", "-r", "10",
                "-pix_fmt", "yuv420p", os.path.join(out, "barcode.y4m")], check=True)
print("out/barcode.y4m ready")
