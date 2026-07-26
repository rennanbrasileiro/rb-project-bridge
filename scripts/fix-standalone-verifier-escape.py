from pathlib import Path
import re

path = Path('electron/services/standalone-service.cjs')
text = path.read_text(encoding='utf-8')
replacement = r'''function verificationScriptSource() {
  return `import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const ignored = new Set(['node_modules','.git','dist','build','coverage']);
const sourceExtensions = new Set(['.js','.jsx','.ts','.tsx','.json','.jsonc','.mjs','.cjs']);
const archivedExtensions = new Set(['js','jsx','ts','tsx','mjs','cjs']);
const failures = [];
function normalizedRelative(file) { return path.relative(root,file).split(path.sep).join('/'); }
function isArchived(file) { const relative=normalizedRelative(file); const parts=relative.split('/'); const fileName=parts.at(-1)||''; const extension=(fileName.split('.').at(-1)||'').toLowerCase(); return parts[0]==='supabase' && parts[1]==='functions' && fileName.startsWith('source.base44.') && archivedExtensions.has(extension); }
function containsBase44Runtime(text) { return text.includes('@base44/sdk') || text.includes('@base44/vite-plugin') || text.includes("from 'base44'") || text.includes('from "base44"'); }
function walk(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { if (ignored.has(entry.name)) continue; const file=path.join(dir,entry.name); if (entry.isDirectory()) { walk(file); continue; } if (!sourceExtensions.has(path.extname(entry.name).toLowerCase())) continue; if (isArchived(file)) continue; const text=fs.readFileSync(file,'utf8'); if (containsBase44Runtime(text)) failures.push(normalizedRelative(file)); } }
walk(root);
const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for (const name of Object.keys({...packageJson.dependencies,...packageJson.devDependencies})) if (name === 'base44' || name.startsWith('@base44/')) failures.push('package.json:' + name);
if (!fs.existsSync(path.join(root,'supabase','config.toml'))) failures.push('supabase/config.toml missing');
if (!fs.existsSync(path.join(root,'.env.example'))) failures.push('.env.example missing');
if (failures.length) { console.error('Standalone gate failed:', failures); process.exit(1); }
console.log('Standalone gate passed: zero Base44 runtime dependencies.');
`;
}
'''
pattern = re.compile(r"function verificationScriptSource\(\) \{.*?\n\}\n\nfunction workflowSource\(\)", re.S)
text, count = pattern.subn(lambda _match: replacement + '\nfunction workflowSource()', text, count=1)
if count != 1:
    if 'function containsBase44Runtime(text)' in text:
        raise SystemExit(0)
    raise SystemExit('verificationScriptSource function not found')
path.write_text(text, encoding='utf-8')
