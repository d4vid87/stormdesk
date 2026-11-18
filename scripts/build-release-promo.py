#!/usr/bin/env python3
"""Build release 4.12.1's narrated 30-second promo from real UI recordings.

Requires ffmpeg plus the optional media-tool environment (not app dependencies):
  uv run --with kokoro-onnx==0.6.1 --python 3.12 python scripts/build-release-promo.py
Uses existing local Kokoro-82M ONNX/tokenizer/af_heart voice assets. Never downloads
models or accesses an owner's browser profile. Run capture-release-promo.cjs first.
"""
import json
import os
from pathlib import Path
import subprocess
import wave
import shutil

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "shots/release-4121/promo"
STEM = "stormdesk-4121-promo"
TRANSCRIPT = (
    "Your weather. Your desk. Meet StormDesk. Open Customize desk, and make it your own. "
    "Move gauges. Rearrange menus. Put your favorite panels exactly where you want them. "
    "Choose from twenty themes and five animated gauge styles. "
    "Explore your station readings, ten-day forecast, and full HookEcho radar. "
    "Make it yours at My Storm Desk dot com."
)
SCENES = [
    ("welcome", 3.0, "Your weather. Your desk. Meet StormDesk.", "YOUR WEATHER. YOUR DESK.", "Meet StormDesk"),
    ("customize", 3.5, "Open Customize desk, and make it your own.", "Make room for your priorities", "Customize your desk"),
    ("move", 3.0, "Move gauges. Rearrange menus.", "Move gauges. Rearrange menus.", "A layout that works for you"),
    ("panels", 4.0, "Put your favorite panels exactly where you want them.", "Everything in its place", "Put your favorite panels where you want them"),
    ("themes", 3.5, "Choose from twenty themes", "Find your atmosphere", "20 themes. One personal weather desk."),
    ("gauges", 2.5, "and five animated gauge styles.", "Make every reading yours", "Five animated gauge styles"),
    ("forecast", 3.5, "Explore your station readings, ten-day forecast,", "See the bigger picture", "Your station + ten-day forecast"),
    ("radar", 3.0, "and full HookEcho radar.", "Follow the weather", "Full HookEcho radar integration"),
    ("outro", 4.0, "Make it yours at My Storm Desk dot com.", "MAKE IT YOURS", "mystormdesk.com"),
]


def run(*args):
    subprocess.run([str(x) for x in args], check=True)


def voice():
    import numpy as np
    from kokoro_onnx import Kokoro
    model = Path(os.environ.get("KOKORO_MODEL_DIR", Path.home() / ".cache/mimic/models/kokoro"))
    vocab = json.loads((model / "tokenizer.json").read_text())["model"]["vocab"]
    voices = WORK / "voices.npz"
    np.savez(voices, af_heart=np.fromfile(model / "voices/af_heart.bin", dtype=np.float32).reshape(-1, 1, 256))
    engine = Kokoro(str(model / "onnx/model.onnx"), str(voices), vocab_config={"vocab": vocab})
    for name, duration, text, _, _ in SCENES:
        samples, rate = engine.create(text.replace("HookEcho", "Hook Echo"), voice="af_heart", speed=0.95, lang="en-us")
        if not len(samples) or not np.isfinite(samples).all():
            raise ValueError("Narration must be non-empty and finite")
        with wave.open(str(WORK / f"voice-{name}.wav"), "wb") as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(rate)
            target.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
        print(json.dumps({"scene": name, "narration_seconds": len(samples) / rate, "scene_seconds": duration}), flush=True)
    (WORK / "narration.txt").write_text(TRANSCRIPT + "\n")


def timestamp(seconds):
    millis = round(seconds * 1000)
    return f"{millis // 3600000:02}:{millis // 60000 % 60:02}:{millis // 1000 % 60:02}.{millis % 1000:03}"


def build():
    metadata = json.loads((WORK / "scenes.json").read_text())
    if metadata["errors"]:
        raise RuntimeError(f"Capture errors: {metadata['errors']}")
    raw = {s["name"]: s for s in metadata["scenes"]}
    regular = "/usr/share/fonts/liberation/LiberationSans-Regular.ttf"
    bold = "/usr/share/fonts/liberation/LiberationSans-Bold.ttf"
    files, captions, elapsed = [], ["WEBVTT\n"], 0.0
    for name, duration, text, title, subtitle in SCENES:
        scene = dict(raw[name])
        if name == "gauges":
            # Keep all five live previews on screen for the whole spoken phrase.
            scene["duration"] = 1.8
        clip = WORK / f"clip-{name}.mp4"
        titlefile, subfile = WORK / f"title-{name}.txt", WORK / f"subtitle-{name}.txt"
        titlefile.write_text(title); subfile.write_text(subtitle)
        ratio = duration / scene["duration"]
        source = f"setpts={ratio:.8f}*(PTS-STARTPTS),fps=30"
        if name in ("customize", "themes"):
            # Actual Customize desk dialog, enlarged without altering its contents.
            picture = source + ",crop=630:940:1280:70,scale=630:940,pad=1920:1080:1210:70:color=0x0c141a"
            title_y, sub_y, title_size, sub_size = 410, 485, 44, 32
        elif name == "gauges":
            picture = source + ",crop=1160:620:380:220,scale=1740:930,pad=1920:1080:90:100:color=0x0c141a"
            title_y, sub_y, title_size, sub_size = 22, 70, 36, 24
        else:
            picture = source + ",scale=1664:936,pad=1920:1080:128:82:color=0x0c141a"
            title_y, sub_y, title_size, sub_size = 20, 1040, 36, 19
        if name in ("welcome", "outro"):
            picture += ",drawbox=x=0:y=0:w=iw:h=ih:color=0x071016@0.80:t=fill"
            title_y, sub_y, title_size, sub_size = 425, 530, 67, 84 if name == "outro" else 84
            xpos = "(w-text_w)/2"
        else:
            xpos = "80" if name in ("customize", "themes") else "128"
        picture += (
            f",drawtext=fontfile={bold}:textfile={titlefile}:fontcolor=0x8de4f5:fontsize={title_size}:x={xpos}:y={title_y}"
            f",drawtext=fontfile={bold if name in ('welcome','outro') else regular}:textfile={subfile}:fontcolor=0xf1f6f7:fontsize={sub_size}:x={xpos}:y={sub_y}"
            ",drawbox=x=0:y=1074:w=1920:h=6:color=0x1e333e:t=fill"
            f",drawbox=x=0:y=1074:w={int(1920*(elapsed+duration)/30)}:h=6:color=0x83d6ec:t=fill"
        )
        if name in ("customize", "themes"):
            picture += f",drawtext=fontfile={regular}:text='Real controls. Your choice.':fontcolor=0x96a9b1:fontsize=23:x=80:y=550"
        picture += f",drawtext=fontfile={regular}:text='DEMO WEATHER  /  STORMDESK':fontcolor=0x91a4ae:fontsize=15:x=1540:y=1045"
        with wave.open(str(WORK / f"voice-{name}.wav"), "rb") as narration:
            voice_seconds = narration.getnframes() / narration.getframerate()
        tempo = max(1.0, voice_seconds / (duration - 0.28))
        audio = f"atempo={tempo:.6f},adelay=110:all=1,apad,atrim=0:{duration},afade=t=out:st={duration-0.08}:d=0.08"
        run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", scene["start"], "-t", scene["duration"], "-i", metadata["video"], "-i", WORK / f"voice-{name}.wav", "-filter_complex", f"[0:v]{picture}[v];[1:a]{audio}[a]", "-map", "[v]", "-map", "[a]", "-t", duration, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-ar", "48000", "-b:a", "160k", clip)
        files.append(clip)
        captions += [f"{timestamp(elapsed + 0.11)} --> {timestamp(min(elapsed + duration - 0.1, elapsed + 0.11 + voice_seconds / tempo))}\n{text}\n"]
        elapsed += duration
    assert elapsed == 30.0
    manifest = WORK / "concat.txt"
    manifest.write_text("".join(f"file '{p}'\n" for p in files))
    dest = ROOT / "docs" / f"{STEM}.mp4"
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", manifest, "-t", "30", "-vf", "setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.2,fade=t=out:st=29.65:d=0.35", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-af", "asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=7,apad,atrim=0:30", "-c:a", "aac", "-ar", "48000", "-b:a", "160k", "-movflags", "+faststart", dest)
    vtt = ROOT / "docs" / f"{STEM}.vtt"
    vtt.write_text("\n".join(captions))
    for file in (dest, vtt):
        shutil.copyfile(file, ROOT / "marketing/images" / file.name)
    print(json.dumps({"video": str(dest), "bytes": dest.stat().st_size, "duration": elapsed, "narration": TRANSCRIPT}), flush=True)


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    if not all((WORK / f"voice-{s[0]}.wav").exists() for s in SCENES):
        voice()
    build()
