# Voice: Owen's narration

Only start once the script is approved. Setup details are in `memory/voice.md`.

1. Split the approved script into takes of 1 to 3 paragraphs, breaking at natural pauses. Save them as `audio/takes.md` with IDs (V01, V02...).
2. Generate each take in the Colab notebook using `Owen.wav`. If the creator needs to run the notebook, give them the exact text for each take, in order, and the exact filenames to save (`V01-raw.wav`...). Keep the instructions short and copy-paste ready.
3. Run each take through Adobe Podcast Enhance Speech and save it as `V01-enhanced.wav`. Keep the raw file too.
4. **The creator listens** and marks each take OK or redo. Claude can't hear audio. Before the creator listens, Claude can check that each take exists, check its length against the expected word count, and transcribe it with the local Whisper setup (`scripts/transcribe.py`) to catch missing or wrong words.
5. Join the accepted takes into `audio/narration.wav` with natural gaps. Transcribe it with word timestamps: `.venv-whisper/Scripts/python scripts/transcribe.py <episode>/audio/narration.wav <episode>/audio/timing.json`. The animation is timed to these timestamps.

Never change the speed of the speech. If the picture doesn't fit, change the picture.
