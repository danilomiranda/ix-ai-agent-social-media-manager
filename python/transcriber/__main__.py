"""
Transcriber CLI — wraps openai-whisper to produce word-level SRT + JSON.

Downloads models from OpenAI CDN (~150MB for 'base', ~1.5GB for 'large-v3').
No HuggingFace account required.

Usage:
  python -m transcriber --video <path> --output <dir> [--language <lang>] [--model <size>]

Model sizes (tradeoff: speed vs accuracy on CPU):
  tiny   ~75MB   fastest, lower accuracy
  base   ~150MB  good balance for testing
  small  ~500MB  better accuracy
  medium ~1.5GB  high accuracy
  large-v3 ~3GB  best accuracy (slow on CPU)

Outputs:
  <output_dir>/transcript.srt         — standard SRT for caption rendering
  <output_dir>/transcript.words.json  — word-level timestamps for clip selection anchoring
"""

import argparse
import json
import os
import sys
from pathlib import Path


def format_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def words_to_srt(word_segments: list, max_chars: int = 60) -> str:
    """Group word-level segments into SRT lines."""
    entries = []
    idx = 1
    current_words = []
    current_start = None

    for word in word_segments:
        w = word.get("word", "").strip()
        start = word.get("start", 0)
        end = word.get("end", 0)

        if not w:
            continue

        if current_start is None:
            current_start = start

        current_words.append(w)
        line = " ".join(current_words)

        if len(line) >= max_chars:
            entries.append(
                f"{idx}\n{format_timestamp(current_start)} --> {format_timestamp(end)}\n{line}\n"
            )
            idx += 1
            current_words = []
            current_start = None

    # Flush remaining
    if current_words and current_start is not None:
        last_end = word_segments[-1].get("end", current_start + 1)
        entries.append(
            f"{idx}\n{format_timestamp(current_start)} --> {format_timestamp(last_end)}\n{' '.join(current_words)}\n"
        )

    return "\n".join(entries)


def transcribe(video_path: str, output_dir: str, language: str = "en", model_size: str = "base"):
    """Run openai-whisper transcription and write outputs."""
    try:
        import whisper
    except ImportError:
        print("ERROR: openai-whisper not installed. Run: pip install openai-whisper", file=sys.stderr)
        sys.exit(1)

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    print(f"[transcriber] Model: {model_size} (downloads from OpenAI CDN if not cached)")
    print(f"[transcriber] Transcribing: {video_path}")

    model = whisper.load_model(model_size)
    result = model.transcribe(video_path, language=language, word_timestamps=True, verbose=False)

    # Flatten word-level segments into a flat list matching the existing schema:
    # [{ "word": str, "start": float, "end": float }, ...]
    word_segments = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            word_segments.append({
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            })

    print(f"[transcriber] Got {len(word_segments)} word segments")

    # Write word-level JSON
    words_path = os.path.join(output_dir, "transcript.words.json")
    with open(words_path, "w") as f:
        json.dump(word_segments, f, indent=2)
    print(f"[transcriber] Wrote: {words_path}")

    # Write SRT
    srt_content = words_to_srt(word_segments)
    srt_path = os.path.join(output_dir, "transcript.srt")
    with open(srt_path, "w") as f:
        f.write(srt_content)
    print(f"[transcriber] Wrote: {srt_path}")

    print("[transcriber] Done.")


def main():
    parser = argparse.ArgumentParser(description="openai-whisper transcriber CLI")
    parser.add_argument("--video", required=True, help="Path to input video file")
    parser.add_argument("--output", required=True, help="Output directory for transcript files")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    parser.add_argument("--model", default="base", help="Whisper model size: tiny/base/small/medium/large-v3 (default: base)")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(f"ERROR: Video file not found: {args.video}", file=sys.stderr)
        sys.exit(1)

    transcribe(args.video, args.output, language=args.language, model_size=args.model)


if __name__ == "__main__":
    main()
