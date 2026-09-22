'use strict';

const { main: startServer } = require('./server.cjs');
const { main: startWorker } = require('./worker.cjs');

async function main() {
  process.env.RB_BRIDGE_EMBEDDED_WORKER = '1';
  await startServer();
  await startWorker();
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

module.exports = { main };
