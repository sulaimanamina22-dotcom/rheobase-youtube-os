"""Demand check: top videos for a topic search, with channel size and outlier ratio.
usage: python -I scripts/demand.py "topic search" [n_search] [n_detail]
views / subscribers above 1 on a small channel = the topic itself pulled the views.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"D:\Rheobase\.venv-whisper\Lib\site-packages")
import yt_dlp

q = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
k = int(sys.argv[3]) if len(sys.argv) > 3 else 8
with yt_dlp.YoutubeDL({"extract_flat": True, "quiet": True}) as y:
    res = y.extract_info(f"ytsearch{n}:{q}", download=False)
ents = sorted([e for e in res.get("entries") or [] if e], key=lambda e: -(e.get("view_count") or 0))
print(f"TOPIC: {q}")
det = {"quiet": True, "skip_download": True, "ignoreerrors": True, "no_warnings": True}
with yt_dlp.YoutubeDL(det) as y:
    for e in ents[:k]:
        v = e.get("view_count") or 0
        subs, date = None, "?"
        try:
            i = y.extract_info(e["url"], download=False, process=False)
            subs, date = i.get("channel_follower_count"), i.get("upload_date") or "?"
        except Exception:
            pass
        ratio = f"{v / subs:6.1f}x" if subs else "    ?"
        print(f"{int(v):>12,} {ratio} subs {int(subs or 0):>11,} {date} {int(e.get('duration') or 0)//60:>3}m "
              f"{str(e.get('channel'))[:22]:<22} {str(e.get('title'))[:70]}")
