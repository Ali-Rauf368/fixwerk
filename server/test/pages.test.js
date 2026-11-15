import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { DEMO_PASSWORD, seedIfEmpty } from '../src/seed.js';

let server;
let base;
before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  const app = createApp({ db, secret: 't' });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('volunteer directory and profile', async () => {
  const fixers = (await call('/fixers')).body;
  assert.equal(fixers.length, 5);
  assert.ok(fixers.every((f) => Array.isArray(f.skills) && !('email' in f) && !('password_hash' in f)));
  const p = (await call(`/fixers/${fixers[0].id}`)).body;
  assert.ok(p.repairs > 0 && p.recent.length > 0 && p.byCategory.length > 0);
  assert.equal((await call('/fixers/1')).status, 404); // organizer is not a fixer
});

test('fixers edit their own skills, validated', async () => {
  const token = (await call('/auth/login', { method: 'POST', body: { email: 'ingrid@fixwerk.demo', password: DEMO_PASSWORD } })).body.token;
  assert.equal((await call('/me/skills', { method: 'PUT', token, body: { skills: ['rockets'] } })).status, 400);
  const ok = await call('/me/skills', { method: 'PUT', token, body: { skills: ['textiles', 'bikes', 'bikes'] } });
  assert.deepEqual(ok.body.skills, ['textiles', 'bikes']);
  assert.deepEqual((await call('/auth/me', { token })).body.skills, ['textiles', 'bikes']);
  assert.equal((await call('/me/skills', { method: 'PUT', body: { skills: [] } })).status, 401);
});

test('event report', async () => {
  const closed = (await call('/events')).body.find((e) => e.status === 'closed');
  const r = (await call(`/events/${closed.id}/report`)).body;
  assert.equal(r.items.length, r.checkedIn);
  assert.ok(r.team.length > 0 && r.impact.repairs > 0);
  assert.ok(r.items.every((i) => !i.visitor.includes(' ')));
  assert.equal((await call('/events/999/report')).status, 404);
});
