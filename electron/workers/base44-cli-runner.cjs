'use strict';

const { pathToFileURL } = require('node:url');

const ARGUMENT_MARKER = '--rb-bridge-base44-args';

function extractCliArguments(argv = process.argv) {
  const markerIndex = argv.lastIndexOf(ARGUMENT_MARKER);
  return markerIndex >= 0 ? argv.slice(markerIndex + 1) : [];
}

async function main() {
  const cliPath = process.env.RB_BRIDGE_BASE44_ENTRY;
  if (!cliPath) throw new Error('RB_BRIDGE_BASE44_ENTRY is not configured.');

  const cliArguments = extractCliArguments();

  // Base44 calls Commander.parseAsync() without an explicit argv parameter.
  // Normalize the vector to the standard Node layout so Commander receives
  // only the actual Base44 arguments after removing executable and script.
  process.argv = [process.execPath, cliPath, ...cliArguments];

  await import(pathToFileURL(cliPath).href);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});

module.exports = { ARGUMENT_MARKER, extractCliArguments };
