'use strict';

class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details;
  }
}

function asBridgeError(error, fallbackCode = 'UNEXPECTED_ERROR') {
  if (error instanceof BridgeError) return error;
  return new BridgeError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    { cause: error instanceof Error ? error.stack : undefined },
  );
}

module.exports = { BridgeError, asBridgeError };
