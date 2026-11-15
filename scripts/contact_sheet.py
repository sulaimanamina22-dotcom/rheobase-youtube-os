"""Tile stills into contact sheets for review.

Usage: .venv-whisper/Scripts/python scripts/contact_sheet.py <stills folder> <out prefix> [cols] [per sheet] [cell width]
"""
import sys
from pathlib import Path
import av, numpy as np

src, out = Path(sys.argv[1]), sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
per = int(sys.argv[4]) if len(sys.argv) > 4 else 12
cw = int(sys.argv[5]) if len(sys.argv) > 5 else 480
files = sorted(src.glob("*.jpg")); ch = cw * 9 // 16
for s in range(0, len(files), per):
    chunk = files[s:s + per]; rows = -(-len(chunk) // cols)
    sheet = np.zeros((rows * ch, cols * cw, 3), np.uint8)
    for i, f in enumerate(chunk):
        fr = next(av.open(str(f)).decode(video=0)).reformat(cw, ch, "rgb24").to_ndarray()
        r, c = divmod(i, cols); sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = fr
    p = f"{out}-{s // per + 1:02d}.jpg"
    c = av.open(p, "w"); st = c.add_stream("mjpeg", rate=1); st.width, st.height = sheet.shape[1], sheet.shape[0]; st.pix_fmt = "yuvj420p"; st.options = {"q:v": "3"}
    for pkt in st.encode(av.VideoFrame.from_ndarray(sheet, "rgb24").reformat(format="yuvj420p")): c.mux(pkt)
    for pkt in st.encode(): c.mux(pkt)
    c.close(); print(p, [f.stem for f in chunk])
