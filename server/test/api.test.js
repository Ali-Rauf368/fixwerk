import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { DEMO_PASSWORD, seedIfEmpty } from '../src/seed.js';

let server;
let base;
const notified = [];

before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  const app = createApp({ db, secret: 'test', notify: (id) => notified.push(id) });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email) => (await call('/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD } })).body.token;

test('full repair flow: check-in, match, claim, finish', async () => {
  const events = (await call('/events')).body;
  const live = events.find((e) => e.status === 'live');
  assert.ok(live);

  const checkin = await call(`/events/${live.id}/tickets`, {
    method: 'POST',
    body: { visitorName: 'Test Person', item: 'Bike', category: 'bikes', problem: 'Chain falls off' },
  });
  assert.equal(checkin.status, 201);
  assert.match(checkin.body.code, /^FX-[A-Z2-9]{4}$/);
  assert.ok(checkin.body.estimatedWaitMin > 0);
  assert.ok(notified.includes(live.id));

  const board = (await call(`/events/${live.id}/board`)).body;
  const mine = board.waiting.find((t) => t.code === checkin.body.code);
  assert.equal(mine.visitor, 'Test'); // only first names are public
  assert.equal(mine.visitor_email, undefined);

  const tomasz = await login('tomasz@fixwerk.demo');
  const bench = (await call(`/events/${live.id}/workbench`, { token: tomasz })).body;
  const ticket = bench.waiting.find((t) => t.code === checkin.body.code);
  assert.equal(ticket.suggestions.length, 3);

  assert.equal((await call(`/tickets/${ticket.id}/claim`, { method: 'POST', token: tomasz })).status, 200);
  const aiko = await login('aiko@fixwerk.demo');
  assert.equal((await call(`/tickets/${ticket.id}/claim`, { method: 'POST', token: aiko })).status, 409);
  assert.equal((await call(`/tickets/${ticket.id}/finish`, { method: 'POST', token: aiko, body: { outcome: 'fixed' } })).status, 403);

  const done = await call(`/tickets/${ticket.id}/finish`, {
    method: 'POST',
    token: tomasz,
    body: { outcome: 'fixed', notes: 'New chain link', weightKg: 13 },
  });
  assert.equal(done.body.status, 'done');

  const status = (await call(`/tickets/by-code/${checkin.body.code.toLowerCase()}`)).body;
  assert.equal(status.outcome, 'fixed');
  assert.equal(status.fixer, 'Tomasz');
});

test('validation and permissions', async () => {
  const events = (await call('/events')).body;
  const closed = events.find((e) => e.status === 'closed');
  const live = events.find((e) => e.status === 'live');
  assert.equal((await call(`/events/${closed.id}/tickets`, { method: 'POST', body: {} })).status, 409);
  const bad = await call(`/events/${live.id}/tickets`, { method: 'POST', body: { category: 'spaceships' } });
  assert.equal(bad.status, 400);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'lena@fixwerk.demo', password: 'x' } })).status, 401);
  assert.equal((await call(`/events/${live.id}/workbench`)).status, 401);
  const fixer = await login('mehmet@fixwerk.demo');
  assert.equal((await call('/events', { method: 'POST', token: fixer, body: {} })).status, 403);
  assert.equal((await call('/nope')).status, 404);
});

test('stats and knowledge search', async () => {
  const stats = (await call('/stats')).body;
  assert.ok(stats.total.repairs > 100);
  assert.ok(stats.perEvent.length >= 6);
  const token = await login('lena@fixwerk.demo');
  const hits = (await call('/knowledge?q=zipper', { token })).body;
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => /zipper/i.test(`${h.item} ${h.problem} ${h.notes}`)));
  assert.deepEqual((await call('/knowledge?q=%25_', { token })).body, []);
});
