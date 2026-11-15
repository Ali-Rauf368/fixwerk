import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signToken, verifyToken, hashPassword, verifyPassword } from '../src/auth.js';
import { summarize, ticketImpact } from '../src/domain/impact.js';
import { estimateWaitMin, rankFixers, typicalDurationMin } from '../src/domain/matching.js';

test('impact counts full, half and zero credit by outcome', () => {
  assert.deepEqual(ticketImpact({ status: 'done', outcome: 'fixed', category: 'bikes', weight_kg: 10 }), { kg: 10, co2: 60 });
  assert.equal(ticketImpact({ status: 'done', outcome: 'partial', category: 'bikes', weight_kg: 10 }).kg, 5);
  assert.equal(ticketImpact({ status: 'done', outcome: 'not_fixable', category: 'bikes' }).kg, 0);
  assert.equal(ticketImpact({ status: 'waiting', category: 'bikes' }).kg, 0);
  // Falls back to the category average weight.
  assert.equal(ticketImpact({ status: 'done', outcome: 'fixed', category: 'appliances' }).kg, 3);
});

test('summarize aggregates success rate per category', () => {
  const s = summarize([
    { status: 'done', outcome: 'fixed', category: 'toys' },
    { status: 'done', outcome: 'not_fixable', category: 'toys' },
    { status: 'waiting', category: 'toys' },
  ]);
  assert.equal(s.repairs, 2);
  assert.equal(s.successRate, 0.5);
  assert.equal(s.byCategory[0].category, 'toys');
});

test('matching prefers skilled, proven and free fixers', () => {
  const fixers = [
    { id: 1, name: 'Busy expert', skills: ['bikes'], activeCount: 2 },
    { id: 2, name: 'Free expert', skills: ['bikes'], activeCount: 0 },
    { id: 3, name: 'Generalist', skills: ['toys'], activeCount: 0 },
  ];
  const history = [
    ...Array.from({ length: 5 }, () => ({ fixer_id: 2, category: 'bikes', outcome: 'fixed' })),
    { fixer_id: 1, category: 'bikes', outcome: 'not_fixable' },
  ];
  const ranked = rankFixers({ category: 'bikes' }, fixers, history);
  assert.deepEqual(ranked.map((r) => r.fixerId), [2, 1, 3]);
  assert.ok(ranked[0].score > 80);
  assert.match(ranked[0].reasons.join(' '), /5\/5/);
});

test('wait estimate uses median duration and parallel fixers', () => {
  const h = [10, 20, 60].map((m) => ({ started_at: '2026-01-01T10:00:00Z', finished_at: new Date(Date.parse('2026-01-01T10:00:00Z') + m * 60000).toISOString() }));
  assert.equal(typicalDurationMin(h), 20);
  assert.equal(typicalDurationMin([]), 25);
  assert.equal(estimateWaitMin(5, 2, 20), 60);
});

test('tokens and passwords', () => {
  const t = signToken({ id: 1 }, 's');
  assert.equal(verifyToken(t, 's').id, 1);
  assert.equal(verifyToken(t, 'other'), null);
  assert.equal(verifyToken(`${t}x`, 's'), null);
  assert.equal(verifyToken(signToken({ id: 1 }, 's', -1), 's'), null);
  const h = hashPassword('pw');
  assert.ok(verifyPassword('pw', h));
  assert.ok(!verifyPassword('nope', h));
});
