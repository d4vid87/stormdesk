"""Offline Kokoro male voice. Invoked by the Linux app with text on stdin."""
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def read_text(stream):
    data = stream.read(4097)
    if not data.strip() or len(data) > 4096 or b'\0' in data:
        raise ValueError('Speech must contain 1–4096 bytes of plain text')
    return data.decode('utf-8')


def render(text, root, output):
    import numpy as np
    from kokoro_onnx import Kokoro

    vocab = json.loads((root / 'tokenizer.json').read_text())['model']['vocab']
    engine = Kokoro(str(root / 'model.onnx'), str(root / 'voices.npz'), vocab_config={'vocab': vocab})
    samples, rate = engine.create(text, voice='am_michael', speed=0.95, lang='en-us')
    if not len(samples) or not np.isfinite(samples).all() or not np.any(samples):
        raise RuntimeError('Natural voice produced no usable audio')
    with wave.open(str(output), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def main():
    text = read_text(sys.stdin.buffer)
    root = Path(sys.argv[1])
    with tempfile.TemporaryDirectory(prefix='stormdesk-voice-') as folder:
        output = Path(folder) / 'speech.wav'
        render(text, root, output)
        if len(sys.argv) == 3:
            shutil.copyfile(output, sys.argv[2])
            return
        player = next((shutil.which(name) for name in ('pw-play', 'paplay', 'aplay') if shutil.which(name)), None)
        if not player:
            raise RuntimeError('Install a PipeWire, PulseAudio or ALSA audio player')
        result = subprocess.run([player, str(output)], capture_output=True, timeout=150)
        if result.returncode:
            raise RuntimeError('Audio playback failed: ' + result.stderr.decode(errors='replace')[:500])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Natural voice unavailable: {error}', file=sys.stderr)
        sys.exit(1)
