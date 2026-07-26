'use strict';

const { spawn } = require('node:child_process');
const { BridgeError } = require('./errors.cjs');
const { redactString } = require('./redaction.cjs');

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new BridgeError('PROCESS_ABORTED', `${command} was cancelled.`, { command: redactString(command), args: args.map(redactString) }));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let safeStdout = '';
    let safeStderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timer = null;

    const emit = (stream, chunk) => {
      const rawText = chunk.toString();
      const safeText = redactString(rawText);
      if (stream === 'stdout') {
        stdout += options.captureSensitive ? rawText : safeText;
        safeStdout += safeText;
      } else {
        stderr += options.captureSensitive ? rawText : safeText;
        safeStderr += safeText;
      }
      options.onOutput?.({ stream, text: safeText });
    };
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }, 2000).unref();
    };
    const abortHandler = () => { aborted = true; terminate(); };
    if (options.signal) options.signal.addEventListener('abort', abortHandler, { once: true });
    if (options.timeoutMs) {
      timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs);
      timer.unref();
    }

    child.stdout.on('data', (chunk) => emit('stdout', chunk));
    child.stderr.on('data', (chunk) => emit('stderr', chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      reject(new BridgeError('PROCESS_START_FAILED', error.message, { command: redactString(command) }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      const safeDetails = { command: redactString(command), args: args.map((arg) => redactString(arg)), code, signal, stdout: safeStdout, stderr: safeStderr };
      if (aborted) reject(new BridgeError('PROCESS_ABORTED', `${command} was cancelled.`, safeDetails));
      else if (timedOut) reject(new BridgeError('PROCESS_TIMEOUT', `${command} exceeded the time limit.`, { ...safeDetails, timeoutMs: options.timeoutMs }));
      else if (code === 0 || options.acceptCodes?.includes(code)) resolve({ code, signal, stdout, stderr, safeStdout, safeStderr });
      else reject(new BridgeError('PROCESS_FAILED', `${command} exited with code ${code}`, safeDetails));
    });
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
    options.onSpawn?.(child);
  });
}

module.exports = { runProcess };
