'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  Base44Service,
  runUtilityModule,
} = require('./services/base44-service.cjs');
const { ARGUMENT_MARKER } = require('./workers/base44-cli-runner.cjs');

Base44Service.prototype.runCli = async function runCli(args, options = {}) {
  await fsp.mkdir(this.sessionDir, { recursive: true });

  const cliPath = this.resolveCliPath();
  const runnerPath = path.join(__dirname, 'workers', 'base44-cli-runner.cjs');
  const output = options.onOutput
    ?? ((entry) => this.emit('base44:output', entry));

  this.logger.info('base44.cli.start', {
    args,
    cliPath,
    runnerPath,
  });

  const result = await runUtilityModule(
    runnerPath,
    [ARGUMENT_MARKER, ...args],
    {
      utilityProcess: this.utilityProcess,
      env: this.sessionEnvironment({
        ...(options.env ?? {}),
        RB_BRIDGE_BASE44_ENTRY: cliPath,
      }),
      timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
      onOutput: output,
      signal: options.signal,
    },
  );

  this.logger.info('base44.cli.finish', { args, code: result.code });
  return result;
};

require('./main.cjs');
