"""Fetch a YouTube video's caption tracks without downloading the video.

Usage: python scripts/fetch-captions.py <youtube-url> <output-dir>

Writes <output-dir>/<video-id>.<lang>.vtt for every English track found
(manual and auto-generated). Uses yt-dlp from .venv-whisper, because
YouTube's signed timedtext URLs return empty responses to plain
server-side fetches; yt-dlp is the reliable route.
"""
import subprocess
import sys
from pathlib import Path

YTDLP = Path(__file__).resolve().parent.parent / ".venv-whisper" / "Scripts" / "yt-dlp.exe"

if len(sys.argv) != 3:
    sys.exit(__doc__)

url, out_dir = sys.argv[1], sys.argv[2]
subprocess.run(
    [
        str(YTDLP),
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "en.*",
        "--sub-format", "vtt",
        "-o", str(Path(out_dir) / "%(id)s.%(ext)s"),
        url,
    ],
    check=True,
)
