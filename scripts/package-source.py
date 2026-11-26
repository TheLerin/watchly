"""Create an inspectable source archive without credentials or generated artifacts."""
import hashlib
import json
import re
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve()
if output.suffix != '.zip':
    raise SystemExit('Provide an output ZIP path.')
blocked = {'.git', 'node_modules', 'dist', '.worker-build', '.wrangler', '.codex-runtime', '.agents', '.codex', '.aws', '.vercel', '__pycache__'}
user_images = {'cloudformation-devadath.png', 's3-bucket-devadath.png'}
def permitted(relative):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or any(part in blocked for part in path.parts):
        return False
    name = path.name
    if name in user_images or name in {'.npmrc', '.yarnrc.yml'} or 'visual-verification' in name:
        return False
    if (name.startswith('.env') and name != '.env.example') or (name.startswith('.dev.vars') and name != '.dev.vars.example'):
        return False
    if path.suffix.lower() in {'.zip', '.log', '.pem', '.key', '.p12', '.pfx'} or 'artifacts' in path.parts:
        return False
    return True

listed = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
files = sorted({name for name in listed if name and permitted(name) and (root / name).is_file()})
inventory = []
secret_patterns = [rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', rb'AKIA[A-Z0-9]{16}', rb'sb_secret_[A-Za-z0-9_-]{24,}']
for name in files:
    file = (root / name).resolve()
    if not file.is_relative_to(root):
        raise SystemExit('Source path escapes repository.')
    data = file.read_bytes()
    if any(re.search(pattern, data) for pattern in secret_patterns):
        raise SystemExit(f'Possible private credential in {name}; archive not created.')
    if name != 'docs/source-inventory.json':
        inventory.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
inventory_path = root / 'docs/source-inventory.json'
inventory_path.write_text(json.dumps({'files': inventory, 'excluded': sorted(blocked), 'note': 'Inventory excludes its own hash. Common-key-pattern checks and path exclusions do not replace a full secret audit.'}, indent=2) + '\n', encoding='utf-8')
files = sorted(set(files + ['docs/source-inventory.json']))
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        archive.write(root / name, name)
check = output.parent / ('watchly-v2.1-source-check-' + uuid.uuid4().hex[:8])
check.mkdir()
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        assert permitted(name) and (check / name).resolve().is_relative_to(check)
    archive.extractall(check)
    for name in files:
        assert hashlib.sha256((check / name).read_bytes()).digest() == hashlib.sha256((root / name).read_bytes()).digest(), name
    assert 'backend/package-lock.json' in archive.namelist() and 'frontend/package-lock.json' in archive.namelist()
print(json.dumps({'archive': str(output), 'bytes': output.stat().st_size, 'files': len(files), 'extracted_to': str(check), 'extraction_hashes_match': True, 'clean_install_verified': False}))
