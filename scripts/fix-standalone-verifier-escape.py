from pathlib import Path
import re

path = Path('electron/services/standalone-service.cjs')
text = path.read_text(encoding='utf-8')
pattern = re.compile(r"function isArchived\(file\) \{ const relative=path\.relative\(root,file\)\.replaceAll\(.*?\);.*? \}")
replacement = "function isArchived(file) { const relative=path.relative(root,file).split(path.sep).join('/'); const parts=relative.split('/'); const fileName=parts.at(-1)||''; const extension=(fileName.split('.').at(-1)||'').toLowerCase(); return parts[0]==='supabase' && parts[1]==='functions' && fileName.startsWith('source.base44.') && ['js','jsx','ts','tsx','mjs','cjs'].includes(extension); }"
text, count = pattern.subn(lambda _match: replacement, text, count=1)
if count != 1:
    if "split(path.sep).join('/')" in text:
        raise SystemExit(0)
    raise SystemExit('Generated verifier isArchived function not found')
path.write_text(text, encoding='utf-8')
