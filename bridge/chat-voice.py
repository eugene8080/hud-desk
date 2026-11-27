"""Local, stdin/stdout SenseVoice worker for received chat audio."""

import json
import os
import re
import sys
from pathlib import Path


LANGUAGES = {"zh", "yue", "en", "ja", "ko"}
TAG = re.compile(r"<\|([^|<>]+)\|>")
MODEL_NAMES = ("iic--SenseVoiceSmall", "iic--speech_fsmn_vad_zh-cn-16k-common-pytorch")


def model_dir(configured: str, model_name: str) -> str:
    local = Path(__file__).resolve().parents[1] / ".local" / "voice" / "models" / model_name
    cache = Path(os.environ.get("MODELSCOPE_CACHE") or Path.home() / ".cache" / "modelscope")
    cached = cache / "models" / model_name / "snapshots" / "master"
    path = Path(configured) if configured else local if local.is_dir() else cached
    # Pass local paths only. FunASR can otherwise treat a missing directory as
    # a hub ID and download at runtime.
    if not (path / "model.pt").is_file():
        raise ValueError("Chat model is not installed")
    return str(path.resolve())


def transcribe(path: str, vad, asr, converter, language: str, max_seconds: int) -> dict[str, str]:
    import soundfile as sf

    with sf.SoundFile(path) as recording:
        if recording.channels != 1 or recording.samplerate != 16000 or not 0 < len(recording) <= max_seconds * 16000:
            raise ValueError("Unsupported audio")
        audio = recording.read(dtype="float32")
    vad_result = vad.generate(input=audio, disable_pbar=True)
    spans = vad_result[0].get("value", []) if vad_result else []
    sentences: list[str] = []
    detected: set[str] = set()
    for start_ms, end_ms in spans or []:
        segment = audio[int(start_ms * 16) : int(end_ms * 16)]
        if not segment.size:
            continue
        result = asr.generate(input=segment, cache={}, language=language, use_itn=True, disable_pbar=True)
        raw = result[0].get("text", "") if result else ""
        tags = set(TAG.findall(raw))
        text = TAG.sub("", raw).strip()
        if not text:
            continue
        spoken = tags & LANGUAGES
        detected.update(spoken)
        chinese = bool(spoken & {"yue", "zh"}) or (not spoken and language in {"yue", "zh"})
        if converter and chinese:
            text = converter.convert(text)
        sentences.append(text)
    detected_language = language if language != "auto" else "und"
    if len(detected) == 1:
        detected_language = next(iter(detected))
    elif detected:
        detected_language = "mul"
    return {"text": " ".join(sentences), "language": detected_language}


def main() -> None:
    # Even native libraries may print to fd 1. Give the protocol a separate
    # handle before redirecting that entire fd to suppressed stderr.
    with os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n") as protocol:
        os.dup2(2, 1)

        def emit(value: dict) -> None:
            print(json.dumps(value, ensure_ascii=True), file=protocol, flush=True)

        language, script, duration_limit, asr_dir, vad_dir = sys.argv[1:]
        max_seconds = int(duration_limit)
        from funasr import AutoModel
        from opencc import OpenCC

        options = {"device": "cuda:0", "disable_update": True, "trust_remote_code": False}
        vad = AutoModel(model=model_dir(vad_dir, MODEL_NAMES[1]), max_single_segment_time=15000,
                        vad_kwargs={"max_single_segment_time": 15000}, **options)
        asr = AutoModel(model=model_dir(asr_dir, MODEL_NAMES[0]), **options)
        converter = OpenCC("s2hk") if script == "s2hk" else None
        emit({"ready": True})
        for line in sys.stdin.buffer:
            try:
                request = json.loads(line)
                emit(transcribe(request["wav"], vad, asr, converter, language, max_seconds))
            except Exception:
                emit({"error": "inference failed"})


if __name__ == "__main__":
    main()
