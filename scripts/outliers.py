"""Find small-channel breakouts across many topic searches.
usage: python -I scripts/outliers.py out.json "query1" "query2" ...
Keeps videos >= 8 min, uploaded 2024 or later, from channels under 2M subs, with views >= 2x subs.
"""
import sys, json
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, r"D:\Rheobase\.venv-whisper\Lib\site-packages")
import yt_dlp

out, queries = sys.argv[1], sys.argv[2:]
seen, hits = set(), []
flat = yt_dlp.YoutubeDL({"extract_flat": True, "quiet": True})
det = yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "ignoreerrors": True, "no_warnings": True})
for q in queries:
    res = flat.extract_info(f"ytsearch25:{q}", download=False)
    for e in res.get("entries") or []:
        if not e or e["id"] in seen:
            continue
        seen.add(e["id"])
        v, d = e.get("view_count") or 0, e.get("duration") or 0
        if d < 480 or v < 100000:
            continue
        try:
            i = det.extract_info(e["url"], download=False, process=False) or {}
        except Exception:
            continue
        subs, date = i.get("channel_follower_count") or 0, i.get("upload_date") or "0"
        if subs and subs < 2_000_000 and date >= "20240101" and v >= 2 * subs:
            h = {"q": q, "views": v, "subs": subs, "x": round(v / subs, 1), "date": date,
                 "min": int(d) // 60, "channel": e.get("channel"), "title": e.get("title"), "id": e["id"]}
            hits.append(h)
            print(f"{v:>11,} {h['x']:>6}x subs {subs:>9,} {date} {h['min']:>3}m {str(h['channel'])[:20]:<20} {h['title'][:70]}", flush=True)
json.dump(sorted(hits, key=lambda h: -h["x"]), open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
