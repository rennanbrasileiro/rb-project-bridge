'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { runProcess } = require('../core/process-runner.cjs');
const { BridgeError } = require('../core/errors.cjs');
const { pathExists, ensureEmptyDir, sha256File } = require('../core/fs-utils.cjs');

class ToolchainService {
  constructor({ toolsDir, logger, emit }) { this.toolsDir = toolsDir; this.logger = logger; this.emit = emit; }
  async findOnPath(name) { const command = process.platform === 'win32' ? 'where.exe' : 'which'; try { const result = await runProcess(command, [name], { timeoutMs: 10_000 }); return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null; } catch { return null; } }
  async download(url, target) { const response = await fetch(url, { headers: { 'User-Agent': 'RB Project Bridge' }, signal: AbortSignal.timeout(10 * 60 * 1000) }); if (!response.ok || !response.body) throw new BridgeError('TOOL_DOWNLOAD_FAILED', `Unable to download ${url}`, { status: response.status }); await fs.mkdir(path.dirname(target), { recursive: true }); await pipeline(Readable.fromWeb(response.body), require('node:fs').createWriteStream(target)); return target; }
  async latestRelease(repository) { const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RB Project Bridge' }, signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new BridgeError('GITHUB_RELEASE_LOOKUP_FAILED', `Unable to resolve latest ${repository} release.`, { status: response.status }); return response.json(); }
  async getGh() {
    const system = await this.findOnPath(process.platform === 'win32' ? 'gh.exe' : 'gh'); if (system) return system;
    const extension = process.platform === 'win32' ? '.exe' : ''; const cached = path.join(this.toolsDir, 'gh', `gh${extension}`); if (await pathExists(cached)) return cached;
    this.emit('toolchain:progress', { tool: 'gh', status: 'running', message: 'Downloading official GitHub CLI...' });
    const release = await this.latestRelease('cli/cli'); const version = String(release.tag_name).replace(/^v/, ''); let asset;
    if (process.platform === 'win32') { const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'; asset = release.assets.find((item) => item.name === `gh_${version}_windows_${arch}.zip`); }
    else if (process.platform === 'linux') { const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'; asset = release.assets.find((item) => item.name === `gh_${version}_linux_${arch}.tar.gz`); }
    if (!asset) throw new BridgeError('GH_ASSET_NOT_FOUND', 'No compatible GitHub CLI release asset was found.');
    const work = path.join(this.toolsDir, '.downloads', asset.name); await this.download(asset.browser_download_url, work);
    const checksumAsset = release.assets.find((item) => /checksums\.txt$/i.test(item.name)); if (!checksumAsset) throw new BridgeError('GH_CHECKSUM_MISSING', 'The GitHub CLI release does not provide a checksum manifest.');
    const checksumPath = path.join(this.toolsDir, '.downloads', checksumAsset.name); await this.download(checksumAsset.browser_download_url, checksumPath);
    const expectedLine = (await fs.readFile(checksumPath, 'utf8')).split(/\r?\n/).find((line) => line.trim().endsWith(asset.name)); const expectedHash = expectedLine?.trim().split(/\s+/)[0]?.toLowerCase(); const actualHash = await sha256File(work);
    if (!expectedHash || expectedHash !== actualHash) throw new BridgeError('GH_CHECKSUM_INVALID', 'GitHub CLI checksum validation failed.', { asset: asset.name });
    const extractDir = path.join(this.toolsDir, '.downloads', `gh-${version}`); await ensureEmptyDir(extractDir);
    if (asset.name.endsWith('.zip')) { const AdmZip = require('adm-zip'); new AdmZip(work).extractAllTo(extractDir, true); } else await runProcess('tar', ['-xzf', work, '-C', extractDir], { timeoutMs: 120_000 });
    const candidates = await this.findFiles(extractDir, process.platform === 'win32' ? 'gh.exe' : 'gh'); if (!candidates[0]) throw new BridgeError('GH_EXTRACT_FAILED', 'GitHub CLI executable was not found after extraction.');
    await fs.mkdir(path.dirname(cached), { recursive: true }); await fs.copyFile(candidates[0], cached); if (process.platform !== 'win32') await fs.chmod(cached, 0o755); else await this.verifyAuthenticode(cached);
    await fs.writeFile(`${cached}.sha256`, await sha256File(cached), 'utf8'); await fs.rm(path.join(this.toolsDir, '.downloads'), { recursive: true, force: true }); this.emit('toolchain:progress', { tool: 'gh', status: 'complete', message: `GitHub CLI ${version} ready.` }); return cached;
  }
  async getGit() {
    const system = await this.findOnPath(process.platform === 'win32' ? 'git.exe' : 'git'); if (system) return system;
    if (process.platform !== 'win32') throw new BridgeError('GIT_MISSING', 'Git is required on this platform and could not be found.');
    const cached = path.join(this.toolsDir, 'mingit', 'cmd', 'git.exe'); if (await pathExists(cached)) return cached;
    this.emit('toolchain:progress', { tool: 'git', status: 'running', message: 'Downloading official MinGit...' }); const release = await this.latestRelease('git-for-windows/git'); const asset = release.assets.find((item) => /^MinGit-.*-64-bit\.zip$/i.test(item.name)); if (!asset) throw new BridgeError('MINGIT_ASSET_NOT_FOUND', 'No compatible MinGit release was found.');
    const archive = path.join(this.toolsDir, '.downloads', asset.name); await this.download(asset.browser_download_url, archive); const target = path.join(this.toolsDir, 'mingit'); await ensureEmptyDir(target); const AdmZip = require('adm-zip'); new AdmZip(archive).extractAllTo(target, true); await fs.rm(path.join(this.toolsDir, '.downloads'), { recursive: true, force: true }); if (!(await pathExists(cached))) throw new BridgeError('MINGIT_EXTRACT_FAILED', 'MinGit executable was not found after extraction.'); await this.verifyAuthenticode(cached); await fs.writeFile(`${cached}.sha256`, await sha256File(cached), 'utf8'); this.emit('toolchain:progress', { tool: 'git', status: 'complete', message: 'MinGit ready.' }); return cached;
  }
  async verifyAuthenticode(executable) { if (process.platform !== 'win32') return true; const escaped = executable.replaceAll("'", "''"); const command = `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($signature.Status -ne 'Valid') { Write-Error $signature.StatusMessage; exit 1 }; Write-Output $signature.SignerCertificate.Subject`; await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { timeoutMs: 60_000 }); return true; }
  async findFiles(root, name) { const matches = []; const walk = async (directory) => { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) await walk(absolute); else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) matches.push(absolute); } }; await walk(root); return matches; }
  async status() { const [gh, git] = await Promise.all([this.findOnPath(process.platform === 'win32' ? 'gh.exe' : 'gh'), this.findOnPath(process.platform === 'win32' ? 'git.exe' : 'git')]); return { platform: process.platform, arch: process.arch, gh, git, toolsDir: this.toolsDir }; }
}
module.exports = { ToolchainService };
