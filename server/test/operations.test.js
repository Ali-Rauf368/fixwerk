import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { DEMO_PASSWORD, seedIfEmpty } from '../src/seed.js';

let server;
let base;
let db;
before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db);
  const app = createApp({ db, secret: 't', rateLimit: false });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const login = async (email, password = DEMO_PASSWORD) => (await call('/auth/login', { method: 'POST', body: { email, password } }));
const liveEvent = async () => (await call('/events')).body.find((e) => e.status === 'live');
const checkIn = async (eventId, extra = {}) =>
  (await call(`/events/${eventId}/tickets`, { method: 'POST', body: { visitorName: 'Rita Test', visitorEmail: 'rita@example.com', item: 'Lamp', category: 'furniture', problem: 'Flickers', ...extra } })).body;
const ticketId = (code) => db.prepare('SELECT id FROM tickets WHERE code = ?').get(code).id;

test('sign-ups decide who counts for matching and waits', async () => {
  const live = await liveEvent();
  const jonas = (await login('jonas@fixwerk.demo')).body.token;
  assert.equal((await call(`/events/${live.id}/rsvp`, { method: 'DELETE', token: jonas })).body.attending, false);
  const bench = (await call(`/events/${live.id}/workbench`, { token: jonas })).body;
  assert.ok(!bench.roster.includes(bench.fixers.find((f) => f.name === 'Jonas Weber')?.id ?? -1));
  assert.ok(bench.waiting.every((w) => w.suggestions.every((s) => s.name !== 'Jonas Weber')), 'Jonas is not signed up');

  assert.equal((await call(`/events/${live.id}/rsvp`, { method: 'POST', token: jonas })).status, 201);
  const roster = (await call(`/events/${live.id}/roster`)).body;
  assert.ok(roster.some((f) => f.name === 'Jonas Weber'));
  assert.equal((await call(`/events/${live.id}/rsvp`, { method: 'DELETE', token: jonas })).body.attending, false);

  const closed = (await call('/events')).body.find((e) => e.status === 'closed');
  assert.equal((await call(`/events/${closed.id}/rsvp`, { method: 'POST', token: jonas })).status, 409);
});

test('finishing with parts updates stock atomically', async () => {
  const live = await liveEvent();
  const tomasz = (await login('tomasz@fixwerk.demo')).body.token;
  const parts = (await call('/parts', { token: tomasz })).body;
  const socket = parts.find((p) => p.name === 'E27 lamp socket');
  const glue = parts.find((p) => p.name === 'Wood glue (50 ml)');

  const t = await checkIn(live.id);
  const id = ticketId(t.code);
  await call(`/tickets/${id}/claim`, { method: 'POST', token: tomasz });

  // Too many glue bottles: the whole finish must roll back, including the socket.
  const tooMany = await call(`/tickets/${id}/finish`, { method: 'POST', token: tomasz, body: { outcome: 'fixed', parts: [{ partId: socket.id, qty: 1 }, { partId: glue.id, qty: glue.stock + 1 }] } });
  assert.equal(tooMany.status, 409);
  assert.match(tooMany.body.error, /Not enough "Wood glue/);
  assert.equal(db.prepare('SELECT stock FROM parts WHERE id = ?').get(socket.id).stock, socket.stock);
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id = ?').get(id).status, 'in_repair');

  const ok = await call(`/tickets/${id}/finish`, { method: 'POST', token: tomasz, body: { outcome: 'fixed', notes: 'New socket', parts: [{ partId: socket.id, qty: 1 }] } });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare('SELECT stock FROM parts WHERE id = ?').get(socket.id).stock, socket.stock - 1);
  assert.equal((await call(`/tickets/${id}/finish`, { method: 'POST', token: tomasz, body: { outcome: 'fixed', parts: [{ partId: socket.id, qty: 1 }] } })).status, 409);
  assert.equal(db.prepare('SELECT stock FROM parts WHERE id = ?').get(socket.id).stock, socket.stock - 1, 'no double use');

  const status = (await call(`/tickets/by-code/${t.code}`)).body;
  assert.deepEqual(status.parts, [{ name: 'E27 lamp socket', qty: 1 }]);
  assert.deepEqual(status.timeline.map((e) => e.action), ['checked_in', 'claimed', 'finished']);
  assert.equal(status.timeline[1].actor, 'Tomasz');

  const mails = db.prepare('SELECT subject FROM outbox WHERE ticket_id = ? ORDER BY id').all(id).map((m) => m.subject);
  assert.deepEqual(mails, ["It's your turn: Lamp", 'Your Lamp is fixed 🎉']);
});

test('inventory management is for organizers', async () => {
  const lena = (await login('lena@fixwerk.demo')).body.token;
  const mehmet = (await login('mehmet@fixwerk.demo')).body.token;
  assert.equal((await call('/parts', { method: 'POST', token: mehmet, body: {} })).status, 403);
  const created = await call('/parts', { method: 'POST', token: lena, body: { name: 'Kettle switch', category: 'appliances', stock: 1, minStock: 2, unitCost: 4 } });
  assert.equal(created.status, 201);
  assert.equal((await call('/parts', { method: 'POST', token: lena, body: { name: 'Kettle switch', category: 'appliances' } })).status, 409);
  assert.equal((await call('/parts', { token: lena })).body.find((p) => p.name === 'Kettle switch').low, true);
  assert.equal((await call(`/parts/${created.body.id}/restock`, { method: 'POST', token: lena, body: { qty: 5 } })).body.stock, 6);
  assert.equal((await call(`/parts/${created.body.id}/restock`, { method: 'POST', token: lena, body: { qty: -5 } })).status, 400);
});

test('team management and deactivation', async () => {
  const lena = (await login('lena@fixwerk.demo')).body;
  const add = await call('/team', { method: 'POST', token: lena.token, body: { name: 'Nina Neu', email: 'Nina@Fixwerk.demo', password: 'short', skills: ['toys'] } });
  assert.equal(add.status, 400);
  const ok = await call('/team', { method: 'POST', token: lena.token, body: { name: 'Nina Neu', email: 'Nina@Fixwerk.demo', password: 'longenough', skills: ['toys'] } });
  assert.equal(ok.status, 201);
  assert.equal((await call('/team', { method: 'POST', token: lena.token, body: { name: 'X', email: 'nina@fixwerk.demo', password: 'longenough' } })).status, 409);

  const nina = (await login('nina@fixwerk.demo', 'longenough')).body.token;
  assert.ok(nina);
  assert.equal((await call(`/team/${ok.body.id}`, { method: 'PATCH', token: lena.token, body: { active: false } })).status, 200);
  assert.equal((await call('/auth/me', { token: nina })).status, 401, 'existing token stops working');
  assert.equal((await login('nina@fixwerk.demo', 'longenough')).status, 403);
  assert.ok(!(await call('/fixers')).body.some((f) => f.name === 'Nina Neu'));
  assert.equal((await call(`/team/${lena.user.id}`, { method: 'PATCH', token: lena.token, body: { active: false } })).status, 400);
  const team = (await call('/team', { token: lena.token })).body;
  assert.equal(team.find((u) => u.name === 'Nina Neu').active, false);
});

test('outbox is organizer-only', async () => {
  const lena = (await login('lena@fixwerk.demo')).body.token;
  const mehmet = (await login('mehmet@fixwerk.demo')).body.token;
  assert.equal((await call('/outbox', { token: mehmet })).status, 403);
  const mails = (await call('/outbox', { token: lena })).body;
  assert.ok(mails.length >= 2 && mails[0].to_email);
});
