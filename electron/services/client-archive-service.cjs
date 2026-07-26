'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256File, safeSlug, readJson, writeJson } = require('../core/fs-utils.cjs');

async function createClientArchive(directory, report) {
  const repositoryDir = report.paths?.repositoryDir ? path.resolve(report.paths.repositoryDir) : null;
  const jobRoot = report.paths?.jobRoot ? path.resolve(report.paths.jobRoot) : null;
  if (!repositoryDir || !jobRoot || path.resolve(directory) !== repositoryDir) return null;
  const target = path.join(jobRoot, `${safeSlug(report.project?.name || 'project')}-client-delivery.zip`);
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addLocalFolder(repositoryDir);
  await new Promise((resolve, reject) => zip.writeZip(target, (error) => error ? reject(error) : resolve()));
  const sha256 = await sha256File(target);
  await fs.writeFile(`${target}.sha256`, `${sha256}  ${path.basename(target)}\n`, 'utf8');
  report.paths.clientDeliveryArchive = target;
  report.deliveryArchive = { path: target, sha256 };
  const manifestPath = path.join(repositoryDir, 'CLIENT_DELIVERY', 'CLIENT_DELIVERY_MANIFEST.json');
  const manifest = await readJson(manifestPath, null);
  if (manifest) {
    manifest.artifacts = { ...(manifest.artifacts || {}), clientArchive: target, clientArchiveSha256: sha256 };
    await writeJson(manifestPath, manifest);
  }
  return report.deliveryArchive;
}

module.exports = { createClientArchive };
