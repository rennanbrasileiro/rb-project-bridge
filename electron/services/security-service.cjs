'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { listFiles, pathExists } = require('../core/fs-utils.cjs');

const REMOVE_NAMES = new Set(['.env','.env.local','.env.production','.env.development','.npmrc','.yarnrc']);
const REMOVE_DIRS = new Set(['.git','node_modules','dist','build','release','.next','.cache','coverage']);
const RULES = [
  ['private-key','critical',/-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['github-token','critical',/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g],
  ['base44-key','critical',/b44k_[A-Za-z0-9_-]{12,}/g],
  ['aws-access-key','critical',/AKIA[0-9A-Z]{16}/g],
  ['jwt','high',/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['generic-secret','high',/(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/gi],
];

class SecurityService {
  constructor({ logger, emit }) { this.logger = logger; this.emit = emit; }
  async validateExportTree(root, limits = {}) {
    const maxFiles = limits.maxFiles ?? 50_000, maxBytes = limits.maxBytes ?? 1_000_000_000;
    let files = 0, bytes = 0; const prohibited = [];
    const walk = async (dir) => { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const absolute = path.join(dir, entry.name), relative = path.relative(root, absolute); if (entry.isSymbolicLink()) prohibited.push({ type:'symlink', path:relative }); else if (entry.isDirectory()) await walk(absolute); else if (entry.isFile()) { files += 1; bytes += (await fs.stat(absolute)).size; if (files > maxFiles) throw new Error(`Export exceeds ${maxFiles} files.`); if (bytes > maxBytes) throw new Error(`Export exceeds ${maxBytes} bytes.`); } else prohibited.push({ type:'special-file', path:relative }); } };
    await walk(root); return { valid: prohibited.length === 0, files, bytes, prohibited };
  }
  async sanitize(root) {
    const removed = [], envKeys = new Set();
    const walk = async (dir) => { for (const entry of await fs.readdir(dir, { withFileTypes:true })) { const absolute = path.join(dir, entry.name), relative = path.relative(root, absolute); if (entry.isSymbolicLink() || (entry.isDirectory() && REMOVE_DIRS.has(entry.name))) { await fs.rm(absolute,{recursive:true,force:true}); removed.push(relative); } else if (entry.isDirectory()) await walk(absolute); else if (entry.isFile() && REMOVE_NAMES.has(entry.name)) { const text = await fs.readFile(absolute,'utf8').catch(()=> ''); for (const line of text.split(/\r?\n/)) { const match=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/); if (match) envKeys.add(match[1]); } await fs.rm(absolute,{force:true}); removed.push(relative); } } };
    await walk(root); if (envKeys.size) await fs.writeFile(path.join(root,'.env.example'), [...envKeys].sort().map((key)=>`${key}=`).join('\n')+'\n','utf8');
    return { removed, envKeys:[...envKeys].sort() };
  }
  async scan(root) {
    const findings=[]; const files=await listFiles(root);
    for (const file of files) { const stat=await fs.stat(file); if (stat.size > 2_000_000) continue; const text=await fs.readFile(file,'utf8').catch(()=>null); if (text===null) continue; const lines=text.split(/\r?\n/); lines.forEach((line,index)=>{ for (const [rule,severity,pattern] of RULES) { pattern.lastIndex=0; if (pattern.test(line)) findings.push({rule,severity,file:path.relative(root,file),line:index+1}); } }); }
    const blocking=findings.filter((item)=>['critical','high'].includes(item.severity)); return { findings, blocking, scannedFiles:files.length };
  }
  async analyzeBase44Dependencies(root) {
    const files=await listFiles(root); let sdkImports=0; const entityFiles=[],functionFiles=[],connectorFiles=[];
    for (const file of files) { const rel=path.relative(root,file).replaceAll('\\','/'); if (/base44\/entities\//i.test(rel)) entityFiles.push(rel); if (/base44\/functions\//i.test(rel)) functionFiles.push(rel); if (/base44\/connectors\//i.test(rel)) connectorFiles.push(rel); const text=await fs.readFile(file,'utf8').catch(()=> ''); if (text.includes('@base44/sdk')) sdkImports += 1; }
    return { sdkImports, entityFiles, functionFiles, connectorFiles };
  }
}
module.exports = { SecurityService };
