"""Input boundary check; actual synthesis is exercised by the Linux voice smoke test."""
import importlib.util
import io
from pathlib import Path

spec = importlib.util.spec_from_file_location('voice', Path(__file__).with_name('natural-voice.py'))
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)
assert voice.read_text(io.BytesIO(b'Test warning.')) == 'Test warning.'
assert voice.read_text(io.BytesIO(b'--help; $(id)')) == '--help; $(id)'
for data in (b'', b'\0', b'x' * 4097, b'\xff'):
    try:
        voice.read_text(io.BytesIO(data))
        raise AssertionError('Invalid speech was accepted')
    except (ValueError, UnicodeDecodeError):
        pass
print('Natural voice input checks passed')
