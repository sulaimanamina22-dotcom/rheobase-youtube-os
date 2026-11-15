# Owen: the voice

Owen is the channel's narrator: an openly synthetic voice, never presented as a real person. There's no on-camera avatar (Hedra and the on-camera Owen ended November 5, 2026).

## The setup

- **Voice:** "Owen-late 30s". Originally designed in ElevenLabs Voice Design (ID `hPPmL7X9XQDUBnz9Zro4`). It's now produced with **VibeVoice** running on Google Colab.
- **Colab notebook:** https://colab.research.google.com/drive/1zH7xR1CwclZ_biYBateT6wo-TU7xikeX#scrollTo=zDa261OtIA3D
- **Conditioning file (the voice reference):** `C:/Users/HP/Desktop/VibeVoice/VibeVoice/demo/voices/Owen.wav`. That's 20.193 seconds, 24 kHz mono, 16-bit, SHA-256 `4530336f9054a757ba4938598b98c7ea0d2e592142c87042f16ec9888ee12e0b`.
- **Second consistency reference:** `outputs/2026-08-10-avatar/owen-intro-tts.wav`.
- **Cleanup:** every generated take goes through **Adobe Podcast Enhance Speech** (free tier) before timing and animation. The creator accepted this sound in September 2026.

## The accepted generation recipe

This recipe produced the narration you accepted in September and October 2026. It was read from the Colab notebook above on November 5, 2026. Use it for every episode:
- VibeVoice community repo, pinned to commit `952326ddb264062466a888cf32a5b2f4e803e16e`.
- VibeVoice-1.5B, `torch_dtype=float16`, `attn_implementation='sdpa'`, `set_ddpm_inference_steps(10)`.
- `generate(..., cfg_scale=1.3, generation_config={'do_sample': False}, is_prefill=True)`, with seed 43 set before each take.
- Prompt: `'Speaker 0: ' + text`. That's one speaker turn per take, about 20 to 60 seconds each.
- The model loads once, and then all takes are generated in a loop.
- **Keep each take under about 120 words.** A 226-word take (Jupiter V18 v02, November 7, 2026) came out at 243 wpm, which is rushed. Takes under about 120 words land at 140 to 208 wpm, averaging about 180. Split long scenes into V##a, V##b and so on.
- Plan runtime at about 180 wpm, not 145.

The episode notebook template is `episodes/2026-11-05-fall-into-jupiter/audio/owen-jupiter-takes.ipynb`.

## Tone

A curious friend explaining something they find amazing. Warm, clear, unhurried, never announcer-like or hyped. Natural pauses. The Vsauce-like turns ("but here's the thing...") should sound like genuine thinking, not a performance.

## Every take gets checked

- Before animation is timed to it, the creator listens to each take. Claude can't hear audio, so never claim a take sounds right.
- Check for: wrong or skipped words, music or extra voices bleeding in (a known VibeVoice issue), robotic delivery, and a voice that drifts away from Owen.
- Keep every original take and every enhanced take. Never speed up or slow down speech to fit the picture; change the animation instead.
- The voice must sound consistent within an episode and across the channel.
