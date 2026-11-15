import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp, csvCell } from '../src/app.js';
import { openDb } from '../src/db.js';
import { triage, tokenize } from '../src/domain/triage.js';
import { DEMO_PASSWORD, seedIfEmpty } from '../src/seed.js';

test('tokenize normalises words and drops noise', () => {
  assert.deepEqual(tokenize('My Bikes brakes, NOT working!'), ['bike', 'brake', 'working']);
});

test('triage guesses category and forecasts from similar repairs', () => {
  const history = [
    ...Array.from({ length: 4 }, () => ({ item: 'Toaster', problem: 'lever will not stay down', category: 'appliances', outcome: 'fixed', notes: 'Cleaned the magnet' })),
    { item: 'Toaster', problem: 'burnt smell', category: 'appliances', outcome: 'not_fixable', notes: 'Heating coil broken' },
    { item: 'Jacket', problem: 'zipper broken', category: 'textiles', outcome: 'fixed', notes: 'New slider' },
  ];
  const r = triage('old toaster, the lever does not stay down', history);
  assert.equal(r.category, 'appliances');
  assert.ok(r.confidence > 0.8);
  assert.equal(r.similarCount, 5);
  assert.equal(r.successChance, 0.71); // (4+1)/(5+2)
  assert.deepEqual(r.tips, ['Cleaned the magnet']);
  assert.equal(triage('   ', history), null);
});

test('csv cells are escaped and formula-safe', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(null), '');
});

let server;
let base;
const events = [];
before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  const app = createApp({ db, secret: 't', notify: (id, extra) => events.push({ id, extra }) });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
};

test('triage endpoint, new-ticket signal, feedback once, csv export', async () => {
  const t = await call('/triage?text=' + encodeURIComponent('city bike gears skip'));
  assert.equal(t.body.category, 'bikes');
  assert.equal(t.headers.get('x-content-type-options'), 'nosniff');

  const live = (await call('/events')).body.find((e) => e.status === 'live');
  const { body: ticket } = await call(`/events/${live.id}/tickets`, { method: 'POST', body: { visitorName: 'Eva', item: 'Lamp', category: 'furniture', problem: '=1+1 flickers' } });
  assert.deepEqual(events.at(-1).extra, { type: 'ticket:new', code: ticket.code, category: 'furniture', item: 'Lamp' });

  assert.equal((await call(`/tickets/by-code/${ticket.code}/feedback`, { method: 'POST', body: { rating: 5 } })).status, 409);
  const jonas = (await call('/auth/login', { method: 'POST', body: { email: 'jonas@fixwerk.demo', password: DEMO_PASSWORD } })).body.token;
  const bench = (await call(`/events/${live.id}/workbench`, { token: jonas })).body;
  const id = bench.waiting.find((w) => w.code === ticket.code).id;
  await call(`/tickets/${id}/claim`, { method: 'POST', token: jonas });
  await call(`/tickets/${id}/finish`, { method: 'POST', token: jonas, body: { outcome: 'fixed', notes: 'New socket' } });

  assert.equal((await call(`/tickets/by-code/${ticket.code}/feedback`, { method: 'POST', body: { rating: 9 } })).status, 400);
  assert.equal((await call(`/tickets/by-code/${ticket.code}/feedback`, { method: 'POST', body: { rating: 5, comment: 'Great' } })).status, 201);
  assert.equal((await call(`/tickets/by-code/${ticket.code}/feedback`, { method: 'POST', body: { rating: 1 } })).status, 409);
  assert.equal((await call(`/tickets/by-code/${ticket.code}`)).body.rating, 5);

  const stats = (await call('/stats')).body;
  assert.ok(stats.rating.avg >= 1 && stats.rating.avg <= 5);
  assert.ok(stats.durationByCategory.length > 0);
  assert.ok(stats.fixers.every((f) => 'rating' in f));

  assert.equal((await call(`/events/${live.id}/export.csv`, { token: jonas })).status, 403);
  const lena = (await call('/auth/login', { method: 'POST', body: { email: 'lena@fixwerk.demo', password: DEMO_PASSWORD } })).body.token;
  const csv = await call(`/events/${live.id}/export.csv`, { token: lena });
  assert.match(csv.headers.get('content-disposition'), /fixwerk-event-\d+\.csv/);
  assert.match(csv.body, /^\uFEFF?code,created_at/); // fetch strips the BOM
  assert.match(csv.body, /'=1\+1 flickers/);
});

test('rate limiting returns 429', async () => {
  let last;
  for (let i = 0; i < 22; i += 1) last = await call('/auth/login', { method: 'POST', body: { email: 'x@y.z', password: 'nope' } });
  assert.equal(last.status, 429);
});
