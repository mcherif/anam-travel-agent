const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');

test('GET /health returns ok', async () => {
  const response = await request(app).get('/health');
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, { status: 'ok' });
});

test('POST /api/session-token fails without ANAM_API_KEY', async () => {
  const originalKey = process.env.ANAM_API_KEY;
  process.env.ANAM_API_KEY = '';

  const response = await request(app)
    .post('/api/session-token')
    .send({ personaConfig: {} });

  assert.strictEqual(response.status, 500);
  assert.ok(response.body.error);

  if (originalKey === undefined) {
    delete process.env.ANAM_API_KEY;
  } else {
    process.env.ANAM_API_KEY = originalKey;
  }
});
