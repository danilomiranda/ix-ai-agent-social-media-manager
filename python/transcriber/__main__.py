"""
Transcriber CLI — wraps WhisperX to produce word-level SRT + JSON.

Usage:
  python -m transcriber --video <path> --output <dir> [--language <lang>] [--model <size>]

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


def transcribe(video_path: str, output_dir: str, language: str = "en", model_size: str = "large-v3"):
    """Run WhisperX transcription and write outputs."""
    try:
        import whisperx
        import torch
    except ImportError:
        print("ERROR: whisperx not installed. Run: pip install whisperx", file=sys.stderr)
        sys.exit(1)

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    print(f"[transcriber] Device: {device}, model: {model_size}")
    print(f"[transcriber] Transcribing: {video_path}")

    # Load model and transcribe
    model = whisperx.load_model(model_size, device, compute_type=compute_type)
    result = model.transcribe(video_path, batch_size=16, language=language)

    # Align to get word-level timestamps
    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    result = whisperx.align(result["segments"], align_model, metadata, video_path, device)

    word_segments = result.get("word_segments", [])
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
    parser = argparse.ArgumentParser(description="WhisperX transcriber CLI")
    parser.add_argument("--video", required=True, help="Path to input video file")
    parser.add_argument("--output", required=True, help="Output directory for transcript files")
    parser.add_argument("--language", default="en", help="Language code (default: en)")
    parser.add_argument("--model", default="large-v3", help="WhisperX model size (default: large-v3)")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(f"ERROR: Video file not found: {args.video}", file=sys.stderr)
        sys.exit(1)

    transcribe(args.video, args.output, language=args.language, model_size=args.model)


if __name__ == "__main__":
    main()
