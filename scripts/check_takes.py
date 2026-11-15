"""Transcribe every raw take with local Whisper and diff it against the take text.

Usage (from the workspace root):
  .venv-whisper/Scripts/python scripts/check_takes.py <episode>/audio
Writes <episode>/audio/transcripts.json and prints, per take, words the
transcript is missing or adds compared with takes.json. Whisper mishears
names and numbers, so a flag means "listen here", not "the take is wrong".
"""
import difflib, json, re, sys
from pathlib import Path
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")
audio = Path(sys.argv[1])
takes = json.loads((audio / "takes.json").read_text(encoding="utf-8"))
norm = lambda s: re.findall(r"[a-z0-9']+", s.lower().replace("-", " "))
model = WhisperModel("base.en", device="cpu", compute_type="int8")
out = {}
for tid in sorted(takes):
    wav = audio / "raw" / f"{tid}-Owen-raw-v01.wav"
    segs, _ = model.transcribe(str(wav), beam_size=5)
    heard = " ".join(s.text.strip() for s in segs)
    want = " ".join(l.split(":", 1)[1] for l in takes[tid].strip().splitlines())
    a, b = norm(want), norm(heard)
    missing, extra = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op in ("delete", "replace"):
            missing.append(" ".join(a[i1:i2]))
        if op in ("insert", "replace"):
            extra.append(" ".join(b[j1:j2]))
    ratio = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
    out[tid] = {"heard": heard, "match": round(ratio, 3), "missing": missing, "extra": extra}
    print(f"{tid:5} match {ratio:.3f}  missing={missing}  heard_instead={extra}", flush=True)
(audio / "transcripts.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print("wrote", audio / "transcripts.json")
