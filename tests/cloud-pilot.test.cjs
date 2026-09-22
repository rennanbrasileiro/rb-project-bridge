'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJobInput } = require('../cloud/server.cjs');

function baseInput() {
  return {
    project: { id: 'app-1', name: 'Agile Hub' },
    repository: { provider: 'gitlab', owner: 'rennan', name: 'agile-hub', strategy: 'create' },
    connections: { base44: '11111111-1111-4111-8111-111111111111', git: '22222222-2222-4222-8222-222222222222' },
    deliveryMode: 'standalone-supabase',
  };
}

test('pilot normalizes a standalone GitLab job safely', () => {
  const output = validateJobInput(baseInput());
  assert.equal(output.repository.provider, 'gitlab');
  assert.equal(output.repository.visibility, 'private');
  assert.equal(output.repository.strategy, 'create');
  assert.equal(output.deliveryMode, 'standalone-supabase');
  assert.equal(output.buildValidation, true);
  assert.equal(output.acceptedAuthorization, true);
});

test('pilot refuses non-GitLab destinations in alpha', () => {
  const input = baseInput();
  input.repository.provider = 'github';
  assert.throws(() => validateJobInput(input), /GitLab/);
});

test('pilot requires opaque connection references instead of raw credentials', () => {
  const input = baseInput();
  delete input.connections.git;
  assert.throws(() => validateJobInput(input), /Conexões Base44 e Git/);
});
