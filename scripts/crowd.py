"""Crowding check: how many YouTube videos already use (nearly) this exact title.
usage: python -I crowd.py "title or question" [n]
"""
import sys, re
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"D:\Rheobase\.venv-whisper\Lib\site-packages")
import yt_dlp

q = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 60
words = lambda s: set(re.findall(r"[a-z0-9]+", s.lower())) - {"the", "a", "an", "of", "to", "you", "if", "what", "is", "in", "into", "your", "would", "happens", "why", "how"}
qw = words(q)
opts = {"extract_flat": True, "quiet": True, "skip_download": True}
with yt_dlp.YoutubeDL(opts) as y:
    info = y.extract_info(f"ytsearch{n}:{q}", download=False)
rows = []
for e in info.get("entries") or []:
    t = e.get("title") or ""
    tw = words(t)
    overlap = len(qw & tw) / max(1, len(qw))
    rows.append((overlap, e.get("view_count") or 0, e.get("channel") or e.get("uploader") or "?", t, e.get("duration") or 0))
near = [r for r in rows if r[0] >= 0.99]
print(f"QUERY: {q}\nresults: {len(rows)}  same-topic titles (all key words): {len(near)}  "
      f"channels: {len(set(r[2] for r in near))}")
big = sorted(near, key=lambda r: -r[1])
for o, v, c, t, d in big[:15]:
    print(f"{int(v):>12,}  {int(d)//60:>3}m  {str(c)[:28]:<28} {str(t)[:80]}")
vs = sorted(r[1] for r in near)
if vs:
    print(f"median views of same-topic videos: {vs[len(vs)//2]:,}; under 10k views: {sum(v < 10000 for v in vs)}")
