"""Install StormDesk's optional local male voice; requires uv and a Linux audio player."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
BASE = f'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/{REV}'
FILES = {
    'onnx/model.onnx': ('model.onnx', '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb'),
    'tokenizer.json': ('tokenizer.json', '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'),
    'voices/am_michael.bin': ('am_michael.bin', '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'),
}


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cached-model-dir', type=Path)
    args = parser.parse_args()
    uv = shutil.which('uv')
    if not uv:
        raise SystemExit('Install uv, then run this command again.')
    root = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'stormdesk/voice'
    root.mkdir(parents=True, exist_ok=True)
    python = root / '.venv/bin/python'
    if not python.exists():
        subprocess.run([uv, 'venv', '--python', '3.13', str(root / '.venv')], check=True)
    subprocess.run([uv, 'pip', 'install', '--python', str(python), 'kokoro-onnx==0.6.1'], check=True)
    for remote, (name, expected) in FILES.items():
        destination = root / name
        if destination.exists() and digest(destination) == expected:
            continue
        pending = root / (name + '.download')
        cached = args.cached_model_dir / remote if args.cached_model_dir else None
        try:
            if cached and cached.exists() and digest(cached) == expected:
                shutil.copyfile(cached, pending)
            else:
                print(f'Downloading {name}…', flush=True)
                with urllib.request.urlopen(f'{BASE}/{remote}', timeout=120) as response, pending.open('wb') as output:
                    shutil.copyfileobj(response, output)
            if digest(pending) != expected:
                raise RuntimeError(f'Checksum mismatch: {name}')
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
    subprocess.run([str(python), '-c',
        'import numpy as np,sys; from pathlib import Path; p=Path(sys.argv[1]); '
        'np.savez(p/"voices.npz", am_michael=np.fromfile(p/"am_michael.bin",dtype="<f4").reshape(510,1,256))', str(root)], check=True)
    (root / 'LICENSE.txt').write_text(
        f'Kokoro-82M by hexgrad; ONNX export by onnx-community. Apache-2.0.\n'
        f'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/{REV}\n')
    print('Natural male voice installed. In StormDesk, choose Enable / Test voice.')


if __name__ == '__main__':
    main()
