'use strict';

const path = require('node:path');
const { FileJobStore } = require('./job-store.cjs');
const { ConnectionStore } = require('./connection-store.cjs');
const { runCloudJob } = require('./run-job.cjs');

const DATA_ROOT = path.resolve(process.env.RB_BRIDGE_CLOUD_DATA || path.join(process.cwd(), '.bridge-cloud'));
const POLL_MS = Math.max(1000, Number(process.env.RB_BRIDGE_WORKER_POLL_MS || 3000));

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function execute(claim, jobs, connections) {
  const { job, release } = claim;
  try {
    const result = await runCloudJob(job, {
      dataRoot: DATA_ROOT,
      connections,
      onEvent: (event) => jobs.appendProgress(job.id, event).catch(() => null),
    });
    const report = result.report || {};
    const reportFiles = report.reportFiles || {};
    const downloadPath = reportFiles.clientDeliveryArchive || report.clientDelivery?.archive?.path || null;
    await jobs.update(job.id, {
      state: 'completed', finishedAt: new Date().toISOString(),
      result: {
        status: report.status,
        checkpoint: report.checkpoint,
        repository: report.github?.url || report.githubRepository?.htmlUrl || null,
        reportFiles,
        downloadPath,
        outputDirectory: result.outputDirectory,
        provider: result.provider,
      },
    });
    await jobs.purgeSecrets(job.id).catch(() => null);
  } catch (error) {
    await jobs.update(job.id, { state: 'failed', finishedAt: new Date().toISOString(), error: { code: error.code || 'CLOUD_JOB_FAILED', message: error.message, details: error.details || null } }).catch(() => null);
  } finally {
    await release().catch(() => null);
  }
}

async function main() {
  const jobs = await new FileJobStore({ root: DATA_ROOT }).init();
  const connections = await new ConnectionStore({ root: DATA_ROOT }).init();
  process.stdout.write(`RB Project Bridge Cloud worker ativo em ${DATA_ROOT}\n`);
  while (true) {
    const claim = await jobs.claimNext();
    if (!claim) { await delay(POLL_MS); continue; }
    await execute(claim, jobs, connections);
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
module.exports = { main, execute };
