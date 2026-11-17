"""Keep the offline installer dependency bundle aligned with the tested Rust lockfile."""
import json
from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())
sources = json.loads((root / 'flatpak/cargo-sources.json').read_text())
expected = {
    f"cargo/vendor/{p['name']}-{p['version']}": p['checksum']
    for p in lock['package'] if p.get('source', '').startswith('registry+')
}
archives = {s['dest']: s['sha256'] for s in sources if s['type'] == 'archive'}
checksums = {
    s['dest']: json.loads(s['contents'])['package']
    for s in sources if s.get('dest-filename') == '.cargo-checksum.json'
}
assert archives == expected, 'Flatpak archives do not match Cargo.lock; regenerate cargo-sources.json'
assert checksums == expected, 'Flatpak vendor checksums do not match Cargo.lock'
print(f'Flatpak: {len(expected)} locked crate archives and vendor checksums match.')
