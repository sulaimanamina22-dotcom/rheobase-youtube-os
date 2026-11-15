"""Measure sound effect clips so a clip can be judged without hearing it.

Usage (from the workspace root):
  .venv-whisper/Scripts/python scripts/measure_sfx.py <folder> [out.json]
Per clip: length, peak and RMS level, noise floor (quietest 10% of 50 ms
frames), dynamic range, share of energy in five bands, and the share that
survives a 200 Hz high-pass (a stand-in for a phone speaker).
"""
import json, sys
from pathlib import Path
import av, numpy as np

def load(p):
    c = av.open(str(p)); s = c.streams.audio[0]
    r = av.AudioResampler(format="flt", layout="mono", rate=48000)
    out = []
    for f in c.decode(s):
        for g in r.resample(f): out.append(g.to_ndarray()[0])
    return np.concatenate(out) if out else np.zeros(1, np.float32)

db = lambda v: round(float(20 * np.log10(max(v, 1e-9))), 1)
res = {}
for p in sorted(Path(sys.argv[1]).iterdir()):
    if p.suffix.lower() not in (".wav", ".mp3", ".flac", ".aiff", ".aif", ".ogg"): continue
    try: x = load(p)
    except Exception as e: print(p.name, "ERR", e); continue
    k = 2400; m = max(1, len(x) // k); fr = np.sqrt((x[:m * k].reshape(m, k) ** 2).mean(1) + 1e-18)
    P = np.abs(np.fft.rfft(x[: min(len(x), 48000 * 60)])) ** 2; f = np.fft.rfftfreq(min(len(x), 48000 * 60), 1 / 48000); tot = P.sum() + 1e-18
    band = lambda lo, hi: round(float(100 * P[(f >= lo) & (f < hi)].sum() / tot))
    res[p.name] = {"s": round(len(x) / 48000, 1), "peak": db(np.abs(x).max()), "rms": db(np.sqrt((x ** 2).mean())),
                   "floor": db(np.percentile(fr, 10)), "loud": db(np.percentile(fr, 95)),
                   "sub": band(0, 80), "low": band(80, 200), "mid": band(200, 2000), "pres": band(2000, 6000), "air": band(6000, 24000), "over200": band(200, 24000)}
    r = res[p.name]
    print(f"{p.name[:48]:48} {r['s']:6}s pk{r['peak']:6} rms{r['rms']:6} floor{r['floor']:6} | sub{r['sub']:3} low{r['low']:3} mid{r['mid']:3} pres{r['pres']:3} air{r['air']:3} | >200Hz {r['over200']}%", flush=True)
if len(sys.argv) > 2: Path(sys.argv[2]).write_text(json.dumps(res, indent=1), encoding="utf-8")
