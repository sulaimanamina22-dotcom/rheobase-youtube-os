"""Transcribe an audio file with local Whisper and write word timings.

Usage (from the workspace root):
  .venv-whisper/Scripts/python scripts/transcribe.py <audio> [out.json] [--model base.en]

Prints the transcript. If out.json is given, writes segments with word-level
start/end times, which the animation is timed against (audio/timing.json).
"""
import argparse
import json

from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("audio")
ap.add_argument("out", nargs="?")
ap.add_argument("--model", default="base.en")
args = ap.parse_args()

model = WhisperModel(args.model, device="cpu", compute_type="int8")
segments, info = model.transcribe(args.audio, beam_size=5, word_timestamps=True)

result = {"audio": args.audio, "duration": round(info.duration, 3), "segments": []}
for seg in segments:
    print(f"[{seg.start:7.2f}s] {seg.text.strip()}", flush=True)
    result["segments"].append({
        "start": round(seg.start, 3),
        "end": round(seg.end, 3),
        "text": seg.text.strip(),
        "words": [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in seg.words],
    })

if args.out:
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    print("wrote", args.out)
