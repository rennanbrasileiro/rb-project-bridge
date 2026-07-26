from pathlib import Path

path = Path('electron/services/standalone-service.cjs')
text = path.read_text(encoding='utf-8')
old = "replaceAll('\\\\','/')"
new = "replaceAll('\\\\\\\\','/')"
if old not in text:
    if new in text:
        raise SystemExit(0)
    raise SystemExit('Verifier escape sequence not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
