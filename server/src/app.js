import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';
import { tx } from './db.js';
import { CATEGORIES, OUTCOMES, isCategory } from './domain/categories.js';
import { summarize } from './domain/impact.js';
import { estimateWaitMin, rankFixers, typicalDurationMin } from './domain/matching.js';
import { triage } from './domain/triage.js';

/** Escape a CSV cell; prefix cells that spreadsheets would run as formulas. */
export function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, field, { max = 200, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s || null;
}

const firstName = (name) => String(name ?? '').split(/\s+/)[0];
const now = () => new Date().toISOString();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, secret: string,
 *           notify?: (eventId: number, extra?: object) => void, staticDir?: string,
 *           rateLimit?: boolean }} options
 */
export function createApp({ db, secret, notify = () => {}, staticDir, rateLimit = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use(express.json({ limit: '50kb' }));

  // Fixed-window, in-memory rate limiter per client IP (fine for a single instance).
  const buckets = new Map();
  const limit = (name, max, windowMs) => (req, _res, next) => {
    if (!rateLimit) return next();
    const t = Date.now();
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
    const key = `${name}:${req.ip}`;
    let b = buckets.get(key);
    if (!b || b.reset < t) buckets.set(key, (b = { count: 0, reset: t + windowMs }));
    if (++b.count > max) throw new HttpError(429, 'Too many requests – please wait a moment');
    next();
  };

  // ---------- data helpers ----------
  const getEvent = (id) => {
    const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
    if (!ev) throw new HttpError(404, 'Event not found');
    return ev;
  };
  const getTicket = (id) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id));
    if (!t) throw new HttpError(404, 'Ticket not found');
    return t;
  };
  /** Fixers available at an event: those who signed up, or every active fixer if nobody has yet. */
  const fixersWithLoad = (eventId) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.skills,
                (SELECT COUNT(*) FROM tickets t WHERE t.fixer_id = u.id AND t.status = 'in_repair') AS activeCount,
                EXISTS (SELECT 1 FROM event_fixers ef WHERE ef.user_id = u.id AND ef.event_id = ?) AS attending
           FROM users u WHERE u.role = 'fixer' AND u.active = 1 ORDER BY u.name`,
      )
      .all(eventId ?? -1)
      .map((f) => ({ ...f, skills: JSON.parse(f.skills), attending: Boolean(f.attending) }));
    const attending = rows.filter((f) => f.attending);
    return attending.length ? attending : rows;
  };

  /** Append to a ticket's audit trail. */
  const log = (ticketId, action, actorId = null, detail = null) =>
    db.prepare('INSERT INTO ticket_log (ticket_id, action, actor_id, detail, at) VALUES (?, ?, ?, ?, ?)').run(ticketId, action, actorId, detail, now());

  /** Queue an email to the visitor (delivered by a mail worker; shown in the dev mailbox). */
  const mail = (ticket, subject, body) => {
    if (!ticket.visitor_email) return;
    db.prepare('INSERT INTO outbox (to_email, subject, body, ticket_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      ticket.visitor_email, subject, body, ticket.id, now(),
    );
  };
  const history = () =>
    db.prepare(`SELECT fixer_id, category, outcome, started_at, finished_at FROM tickets WHERE status = 'done'`).all();

  /** Waiting queue (FIFO) with position and estimated wait for an event. */
  const queueFor = (eventId) => {
    const waiting = db
      .prepare(`SELECT * FROM tickets WHERE event_id = ? AND status = 'waiting' ORDER BY created_at, id`)
      .all(eventId);
    const duration = typicalDurationMin(history());
    const fixerCount = fixersWithLoad(eventId).length;
    return waiting.map((t, i) => ({ ...t, position: i + 1, estimatedWaitMin: estimateWaitMin(i + 1, fixerCount, duration) }));
  };

  const newCode = () => {
    for (;;) {
      let code = 'FX-';
      for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!db.prepare('SELECT 1 FROM tickets WHERE code = ?').get(code)) return code;
    }
  };

  // ---------- auth ----------
  const auth =
    (...roles) =>
    (req, _res, next) => {
      const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const user = verifyToken(token, secret);
      if (!user) throw new HttpError(401, 'Please sign in');
      if (!db.prepare('SELECT active FROM users WHERE id = ?').get(user.id)?.active) throw new HttpError(401, 'Your account is not active');
      if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'You are not allowed to do this');
      req.user = user;
      next();
    };

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.post('/auth/login', limit('login', 20, 5 * 60_000), (req, res) => {
    const email = text(req.body?.email, 'Email').toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(req.body?.password ?? '', user.password_hash)) {
      throw new HttpError(401, 'Wrong email or password');
    }
    if (!user.active) throw new HttpError(403, 'This account has been deactivated. Please contact an organizer.');
    const profile = { id: user.id, name: user.name, role: user.role, skills: JSON.parse(user.skills) };
    res.json({ token: signToken({ id: user.id, name: user.name, role: user.role }, secret), user: profile });
  });

  api.get('/auth/me', auth(), (req, res) => {
    const u = db.prepare('SELECT id, name, email, role, skills FROM users WHERE id = ?').get(req.user.id);
    if (!u) throw new HttpError(401, 'Please sign in');
    res.json({ ...u, skills: JSON.parse(u.skills) });
  });

  api.get('/categories', (_req, res) => {
    res.json(Object.entries(CATEGORIES).map(([key, c]) => ({ key, ...c })));
  });

  // ---------- events ----------
  api.get('/events', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT e.*,
                COUNT(t.id) AS tickets,
                SUM(t.status = 'waiting') AS waiting,
                SUM(t.status = 'done' AND t.outcome IN ('fixed', 'partial')) AS fixed,
                (SELECT COUNT(*) FROM event_fixers ef WHERE ef.event_id = e.id) AS volunteers
           FROM events e LEFT JOIN tickets t ON t.event_id = e.id
          GROUP BY e.id ORDER BY e.starts_at DESC`,
      )
      .all();
    res.json(rows.map((r) => ({ ...r, waiting: r.waiting ?? 0, fixed: r.fixed ?? 0 })));
  });

  api.post('/events', auth('organizer'), (req, res) => {
    const title = text(req.body?.title, 'Title', { max: 120 });
    const location = text(req.body?.location, 'Location', { max: 160 });
    const startsAt = new Date(req.body?.startsAt ?? '');
    if (Number.isNaN(startsAt.getTime())) throw new HttpError(400, 'Start time is invalid');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO events (title, location, starts_at) VALUES (?, ?, ?)')
      .run(title, location, startsAt.toISOString());
    res.status(201).json(getEvent(lastInsertRowid));
  });

  api.patch('/events/:id', auth('organizer'), (req, res) => {
    const ev = getEvent(req.params.id);
    const status = req.body?.status;
    if (!['planned', 'live', 'closed'].includes(status)) throw new HttpError(400, 'Unknown status');
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, ev.id);
    notify(ev.id);
    res.json(getEvent(ev.id));
  });

  // ---------- public check-in, board and status ----------
  api.get('/triage', limit('triage', 120, 60_000), (req, res) => {
    const q = typeof req.query.text === 'string' ? req.query.text.slice(0, 600) : '';
    const past = db.prepare(`SELECT item, brand, problem, category, outcome, notes FROM tickets WHERE status = 'done'`).all();
    res.json(triage(q, past));
  });

  api.post('/events/:id/tickets', limit('checkin', 30, 10 * 60_000), (req, res) => {
    const ev = getEvent(req.params.id);
    if (ev.status !== 'live') throw new HttpError(409, 'Check-in is only open while the event is live');
    const category = req.body?.category;
    if (!isCategory(category)) throw new HttpError(400, 'Please choose a category');
    const email = text(req.body?.visitorEmail, 'Email', { max: 160, required: false });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email looks invalid');

    const code = newCode();
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO tickets (event_id, code, visitor_name, visitor_email, item, category, brand, problem, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ev.id,
      code,
      text(req.body?.visitorName, 'Name', { max: 80 }),
      email,
      text(req.body?.item, 'Item', { max: 80 }),
      category,
      text(req.body?.brand, 'Brand', { max: 60, required: false }),
      text(req.body?.problem, 'Problem description', { max: 600 }),
      now(),
    );
    log(Number(lastInsertRowid), 'checked_in');
    notify(ev.id, { type: 'ticket:new', code, category, item: req.body.item.trim() });
    const mine = queueFor(ev.id).find((t) => t.code === code);
    res.status(201).json({ code, position: mine.position, estimatedWaitMin: mine.estimatedWaitMin });
  });

  api.get('/events/:id/board', (req, res) => {
    const ev = getEvent(req.params.id);
    const publicTicket = (t) => ({
      code: t.code,
      item: t.item,
      category: t.category,
      visitor: firstName(t.visitor_name),
      status: t.status,
      outcome: t.outcome,
      fixer: t.fixer_name ? firstName(t.fixer_name) : null,
      position: t.position,
      estimatedWaitMin: t.estimatedWaitMin,
      startedAt: t.started_at,
    });
    const others = db
      .prepare(
        `SELECT t.*, u.name AS fixer_name FROM tickets t LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.event_id = ? AND t.status != 'waiting' ORDER BY COALESCE(t.finished_at, t.started_at) DESC`,
      )
      .all(ev.id);
    const all = db.prepare('SELECT * FROM tickets WHERE event_id = ?').all(ev.id);
    res.json({
      event: ev,
      waiting: queueFor(ev.id).map(publicTicket),
      inRepair: others.filter((t) => t.status === 'in_repair').map(publicTicket),
      done: others.filter((t) => t.status === 'done').slice(0, 12).map(publicTicket),
      impact: summarize(all),
    });
  });

  api.get('/tickets/by-code/:code', (req, res) => {
    const t = db
      .prepare(
        `SELECT t.*, u.name AS fixer_name, e.title AS event_title FROM tickets t
           JOIN events e ON e.id = t.event_id LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.code = ?`,
      )
      .get(String(req.params.code).toUpperCase());
    if (!t) throw new HttpError(404, 'No ticket with this code');
    const queued = t.status === 'waiting' ? queueFor(t.event_id).find((q) => q.id === t.id) : null;
    res.json({
      code: t.code,
      eventId: t.event_id,
      eventTitle: t.event_title,
      item: t.item,
      category: t.category,
      status: t.status,
      outcome: t.outcome,
      notes: t.notes,
      fixer: t.fixer_name ? firstName(t.fixer_name) : null,
      position: queued?.position ?? null,
      estimatedWaitMin: queued?.estimatedWaitMin ?? null,
      rating: t.rating,
      parts: db.prepare('SELECT p.name, tp.qty FROM ticket_parts tp JOIN parts p ON p.id = tp.part_id WHERE tp.ticket_id = ?').all(t.id),
      timeline: db
        .prepare('SELECT l.action, l.detail, l.at, u.name AS actor FROM ticket_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.ticket_id = ? ORDER BY l.at, l.id')
        .all(t.id)
        .map((l) => ({ action: l.action, detail: l.detail, at: l.at, actor: l.actor ? firstName(l.actor) : null })),
    });
  });

  api.post('/tickets/by-code/:code/feedback', limit('feedback', 20, 10 * 60_000), (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (!t) throw new HttpError(404, 'No ticket with this code');
    if (t.status !== 'done') throw new HttpError(409, 'You can rate the repair once it is finished');
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be 1 to 5 stars');
    const { changes } = db
      .prepare('UPDATE tickets SET rating = ?, feedback = ? WHERE id = ? AND rating IS NULL')
      .run(rating, text(req.body?.comment, 'Comment', { max: 500, required: false }), t.id);
    if (!changes) throw new HttpError(409, 'Feedback was already given – thank you!');
    log(t.id, 'rated', null, String(rating));
    res.status(201).json({ ok: true });
  });

  // ---------- workbench (fixers & organizers) ----------
  api.get('/events/:id/workbench', auth('fixer', 'organizer'), (req, res) => {
    const ev = getEvent(req.params.id);
    const fixers = fixersWithLoad(ev.id);
    const hist = history();
    const roster = db.prepare('SELECT user_id FROM event_fixers WHERE event_id = ?').all(ev.id).map((r) => r.user_id);
    const inRepair = db
      .prepare(
        `SELECT t.*, u.name AS fixer_name FROM tickets t LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.event_id = ? AND t.status = 'in_repair' ORDER BY t.started_at`,
      )
      .all(ev.id);
    res.json({
      event: ev,
      fixers: fixers.map(({ id, name, skills, activeCount }) => ({ id, name, skills, activeCount })),
      waiting: queueFor(ev.id).map((t) => ({ ...t, suggestions: rankFixers(t, fixers, hist).slice(0, 3) })),
      inRepair,
      roster,
      parts: db.prepare('SELECT id, name, category, stock FROM parts WHERE stock > 0 ORDER BY name').all(),
    });
  });

  const startRepair = (ticket, fixerId, actor) => {
    const ev = getEvent(ticket.event_id);
    if (ev.status !== 'live') throw new HttpError(409, 'The event is not live');
    const fixer = db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'fixer' AND active = 1`).get(Number(fixerId));
    if (!fixer) throw new HttpError(400, 'Unknown fixer');
    tx(db, () => {
      // Conditional update so two fixers cannot grab the same ticket.
      const { changes } = db
        .prepare(`UPDATE tickets SET status = 'in_repair', fixer_id = ?, started_at = ? WHERE id = ? AND status = 'waiting'`)
        .run(fixer.id, now(), ticket.id);
      if (!changes) throw new HttpError(409, 'Someone else already took this item');
      db.prepare('INSERT OR IGNORE INTO event_fixers (event_id, user_id) VALUES (?, ?)').run(ev.id, fixer.id);
      log(ticket.id, actor.id === fixer.id ? 'claimed' : 'assigned', actor.id, firstName(fixer.name));
      mail(
        ticket,
        `It's your turn: ${ticket.item}`,
        `Hi ${firstName(ticket.visitor_name)},\n\n${firstName(fixer.name)} is ready to look at your ${ticket.item} now. Please come to the repair bench and bring ticket ${ticket.code}.\n\nSee you in a minute!\nYour Fixwerk team`,
      );
    });
    notify(ticket.event_id);
  };

  api.post('/tickets/:id/claim', auth('fixer'), (req, res) => {
    const t = getTicket(req.params.id);
    startRepair(t, req.user.id, req.user);
    res.json(getTicket(t.id));
  });

  api.post('/tickets/:id/assign', auth('organizer'), (req, res) => {
    const t = getTicket(req.params.id);
    startRepair(t, req.body?.fixerId, req.user);
    res.json(getTicket(t.id));
  });

  const mayWorkOn = (t, user) => {
    if (t.status !== 'in_repair') throw new HttpError(409, 'This item is not being repaired');
    if (user.role !== 'organizer' && t.fixer_id !== user.id) throw new HttpError(403, 'This item belongs to another fixer');
  };

  api.post('/tickets/:id/release', auth('fixer', 'organizer'), (req, res) => {
    const t = getTicket(req.params.id);
    mayWorkOn(t, req.user);
    db.prepare(`UPDATE tickets SET status = 'waiting', fixer_id = NULL, started_at = NULL WHERE id = ?`).run(t.id);
    log(t.id, 'released', req.user.id);
    notify(t.event_id);
    res.json(getTicket(t.id));
  });

  api.post('/tickets/:id/finish', auth('fixer', 'organizer'), (req, res) => {
    const t = getTicket(req.params.id);
    mayWorkOn(t, req.user);
    const outcome = req.body?.outcome;
    if (!OUTCOMES.includes(outcome)) throw new HttpError(400, 'Please choose an outcome');
    let weight = req.body?.weightKg;
    if (weight === '' || weight == null) weight = null;
    else {
      weight = Number(weight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 200) throw new HttpError(400, 'Weight must be between 0 and 200 kg');
    }
    const notes = text(req.body?.notes, 'Notes', { max: 1000, required: false });
    const wanted = new Map();
    for (const p of Array.isArray(req.body?.parts) ? req.body.parts : []) {
      const partId = Number(p?.partId);
      const qty = Number(p?.qty);
      if (!Number.isInteger(partId) || !Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, 'Invalid part or quantity');
      wanted.set(partId, (wanted.get(partId) ?? 0) + qty);
    }

    // All-or-nothing: stock, parts used, ticket and audit log change together.
    tx(db, () => {
      for (const [partId, qty] of wanted) {
        const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(partId);
        if (!part) throw new HttpError(400, 'Unknown part');
        const { changes } = db.prepare('UPDATE parts SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, partId, qty);
        if (!changes) throw new HttpError(409, `Not enough "${part.name}" in stock (${part.stock} left)`);
        db.prepare('INSERT INTO ticket_parts (ticket_id, part_id, qty) VALUES (?, ?, ?)').run(t.id, partId, qty);
      }
      const { changes } = db
        .prepare(`UPDATE tickets SET status = 'done', outcome = ?, notes = ?, weight_kg = ?, finished_at = ? WHERE id = ? AND status = 'in_repair'`)
        .run(outcome, notes, weight, now(), t.id);
      if (!changes) throw new HttpError(409, 'This item is not being repaired');
      log(t.id, 'finished', req.user.id, outcome);
    });

    const verdict = { fixed: 'is fixed 🎉', partial: 'is partly fixed', advice: 'could not be fixed today, but we have advice for you', not_fixable: 'could unfortunately not be fixed' }[outcome];
    mail(
      t,
      `Your ${t.item} ${verdict}`,
      `Hi ${firstName(t.visitor_name)},\n\nyour ${t.item} ${verdict}.${notes ? `\n\nNote from the fixer: ${notes}` : ''}\n\nYou can rate your visit here: /status/${t.code}\n\nThanks for repairing instead of throwing away!\nYour Fixwerk team`,
    );
    notify(t.event_id);
    res.json(getTicket(t.id));
  });

  // ---------- impact & knowledge ----------
  api.get('/stats', (_req, res) => {
    const all = db.prepare('SELECT * FROM tickets').all();
    const events = db.prepare(`SELECT * FROM events WHERE status != 'planned' ORDER BY starts_at`).all();
    const fixers = db
      .prepare(
        `SELECT u.id, u.name, COUNT(t.id) AS repairs,
                SUM(t.outcome IN ('fixed', 'partial')) AS fixed,
                ROUND(AVG(t.rating), 2) AS rating, COUNT(t.rating) AS ratings
           FROM users u JOIN tickets t ON t.fixer_id = u.id AND t.status = 'done'
          WHERE u.role = 'fixer' GROUP BY u.id ORDER BY fixed DESC, repairs DESC`,
      )
      .all();
    res.json({
      total: summarize(all),
      perEvent: events.map((e) => {
        const s = summarize(all.filter((t) => t.event_id === e.id));
        return { id: e.id, title: e.title, startsAt: e.starts_at, repairs: s.repairs, fixed: s.fixed, kgSaved: s.kgSaved, co2SavedKg: s.co2SavedKg };
      }),
      fixers: fixers.map((f) => ({ ...f, fixed: f.fixed ?? 0 })),
      rating: db.prepare('SELECT ROUND(AVG(rating), 2) AS avg, COUNT(rating) AS count FROM tickets').get(),
      recentFeedback: db
        .prepare(`SELECT item, rating, feedback, finished_at FROM tickets WHERE feedback IS NOT NULL ORDER BY finished_at DESC LIMIT 4`)
        .all(),
      durationByCategory: Object.keys(CATEGORIES)
        .map((c) => {
          const rows = all.filter((t) => t.category === c && t.status === 'done');
          return { category: c, label: CATEGORIES[c].label, minutes: rows.length ? typicalDurationMin(rows) : null };
        })
        .filter((d) => d.minutes != null)
        .sort((a, b) => b.minutes - a.minutes),
    });
  });

  const EXPORT_COLUMNS = ['code', 'created_at', 'visitor_name', 'item', 'brand', 'category', 'problem', 'status', 'outcome', 'fixer', 'weight_kg', 'notes', 'rating', 'feedback'];
  api.get('/events/:id/export.csv', auth('organizer'), (req, res) => {
    const ev = getEvent(req.params.id);
    const rows = db
      .prepare(
        `SELECT t.*, u.name AS fixer FROM tickets t LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.event_id = ? ORDER BY t.created_at`,
      )
      .all(ev.id);
    const lines = [EXPORT_COLUMNS.join(','), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(','))];
    res.type('text/csv').attachment(`fixwerk-event-${ev.id}.csv`).send(`﻿${lines.join('\r\n')}\r\n`);
  });

  api.get('/knowledge', auth(), (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const category = isCategory(req.query.category) ? req.query.category : null;
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = db
      .prepare(
        `SELECT t.id, t.item, t.brand, t.category, t.problem, t.notes, t.outcome, t.finished_at, u.name AS fixer
           FROM tickets t LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.status = 'done' AND t.notes IS NOT NULL
            AND (? IS NULL OR t.category = ?)
            AND (t.item LIKE ? ESCAPE '\\' OR t.brand LIKE ? ESCAPE '\\' OR t.problem LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')
          ORDER BY t.finished_at DESC LIMIT 60`,
      )
      .all(category, category, like, like, like, like);
    res.json(rows);
  });

  // ---------- volunteer sign-ups ----------
  api.get('/events/:id/roster', (req, res) => {
    const ev = getEvent(req.params.id);
    const rows = db
      .prepare(`SELECT u.id, u.name, u.skills FROM event_fixers ef JOIN users u ON u.id = ef.user_id WHERE ef.event_id = ? AND u.active = 1 ORDER BY u.name`)
      .all(ev.id);
    res.json(rows.map(withSkills));
  });

  api.post('/events/:id/rsvp', auth('fixer'), (req, res) => {
    const ev = getEvent(req.params.id);
    if (ev.status === 'closed') throw new HttpError(409, 'This event is already over');
    db.prepare('INSERT OR IGNORE INTO event_fixers (event_id, user_id) VALUES (?, ?)').run(ev.id, req.user.id);
    notify(ev.id);
    res.status(201).json({ attending: true });
  });

  api.delete('/events/:id/rsvp', auth('fixer'), (req, res) => {
    const ev = getEvent(req.params.id);
    const busy = db.prepare(`SELECT 1 FROM tickets WHERE event_id = ? AND fixer_id = ? AND status = 'in_repair'`).get(ev.id, req.user.id);
    if (busy) throw new HttpError(409, 'Finish or release your items first');
    db.prepare('DELETE FROM event_fixers WHERE event_id = ? AND user_id = ?').run(ev.id, req.user.id);
    notify(ev.id);
    res.json({ attending: false });
  });

  // ---------- team management ----------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const skillList = (v) => {
    if (v == null) return [];
    if (!Array.isArray(v) || !v.every(isCategory)) throw new HttpError(400, 'Unknown skill');
    return [...new Set(v)];
  };

  api.get('/team', auth('organizer'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.skills, u.active,
                (SELECT COUNT(*) FROM tickets t WHERE t.fixer_id = u.id AND t.status = 'done') AS repairs
           FROM users u ORDER BY u.active DESC, u.role DESC, u.name`,
      )
      .all();
    res.json(rows.map((u) => ({ ...withSkills(u), active: Boolean(u.active) })));
  });

  api.post('/team', auth('organizer'), (req, res) => {
    const name = text(req.body?.name, 'Name', { max: 80 });
    const email = text(req.body?.email, 'Email', { max: 160 }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email looks invalid');
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8) throw new HttpError(400, 'Password must have at least 8 characters');
    const role = req.body?.role === 'organizer' ? 'organizer' : 'fixer';
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Someone with this email already exists');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash, role, skills) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, hashPassword(password), role, JSON.stringify(role === 'fixer' ? skillList(req.body?.skills) : []));
    res.status(201).json({ id: Number(lastInsertRowid), name, email, role });
  });

  api.patch('/team/:id', auth('organizer'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account');
    if (typeof req.body?.active !== 'boolean') throw new HttpError(400, 'active must be true or false');
    const { changes } = db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
    if (!changes) throw new HttpError(404, 'User not found');
    res.json({ id, active: req.body.active });
  });

  // ---------- spare parts ----------
  const intIn = (v, field, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
    return n;
  };

  api.get('/parts', auth(), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.*, COALESCE((SELECT SUM(qty) FROM ticket_parts tp WHERE tp.part_id = p.id), 0) AS used
           FROM parts p ORDER BY p.category, p.name`,
      )
      .all();
    res.json(rows.map((p) => ({ ...p, low: p.stock <= p.min_stock })));
  });

  api.post('/parts', auth('organizer'), (req, res) => {
    const name = text(req.body?.name, 'Name', { max: 80 });
    if (!isCategory(req.body?.category)) throw new HttpError(400, 'Please choose a category');
    const unitCost = Number(req.body?.unitCost ?? 0);
    if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10_000) throw new HttpError(400, 'Unit cost is invalid');
    if (db.prepare('SELECT 1 FROM parts WHERE name = ?').get(name)) throw new HttpError(409, 'A part with this name already exists');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO parts (name, category, stock, min_stock, unit_cost) VALUES (?, ?, ?, ?, ?)')
      .run(name, req.body.category, intIn(req.body?.stock ?? 0, 'Stock', 0, 10_000), intIn(req.body?.minStock ?? 0, 'Minimum stock', 0, 10_000), unitCost);
    res.status(201).json(db.prepare('SELECT * FROM parts WHERE id = ?').get(lastInsertRowid));
  });

  api.post('/parts/:id/restock', auth('organizer'), (req, res) => {
    const qty = intIn(req.body?.qty, 'Quantity', 1, 1000);
    const { changes } = db.prepare('UPDATE parts SET stock = stock + ? WHERE id = ?').run(qty, Number(req.params.id));
    if (!changes) throw new HttpError(404, 'Part not found');
    res.json(db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id)));
  });

  // ---------- email outbox (dev mailbox) ----------
  api.get('/outbox', auth('organizer'), (_req, res) => {
    res.json(db.prepare('SELECT o.*, t.code FROM outbox o LEFT JOIN tickets t ON t.id = o.ticket_id ORDER BY o.id DESC LIMIT 50').all());
  });

  // ---------- volunteers & event reports ----------
  const fixerStats = db.prepare(
    `SELECT u.id, u.name, u.skills,
            COUNT(t.id) AS repairs,
            COALESCE(SUM(t.outcome IN ('fixed', 'partial')), 0) AS fixed,
            ROUND(AVG(t.rating), 2) AS rating, COUNT(t.rating) AS ratings
       FROM users u LEFT JOIN tickets t ON t.fixer_id = u.id AND t.status = 'done'
      WHERE u.role = 'fixer' AND u.active = 1 AND (? IS NULL OR u.id = ?)
      GROUP BY u.id ORDER BY fixed DESC, u.name`,
  );
  const withSkills = (f) => ({ ...f, skills: JSON.parse(f.skills) });

  api.get('/fixers', (_req, res) => {
    res.json(fixerStats.all(null, null).map(withSkills));
  });

  api.get('/fixers/:id', (req, res) => {
    const id = Number(req.params.id);
    const f = fixerStats.get(id, id);
    if (!f) throw new HttpError(404, 'Volunteer not found');
    const done = db.prepare(`SELECT * FROM tickets WHERE fixer_id = ? AND status = 'done' ORDER BY finished_at DESC`).all(id);
    const s = summarize(done);
    res.json({
      ...withSkills(f),
      kgSaved: s.kgSaved,
      co2SavedKg: s.co2SavedKg,
      byCategory: s.byCategory,
      typicalMinutes: done.length ? typicalDurationMin(done) : null,
      events: db.prepare(`SELECT COUNT(DISTINCT event_id) AS n FROM tickets WHERE fixer_id = ?`).get(id).n,
      recent: done.slice(0, 12).map((t) => ({ id: t.id, item: t.item, brand: t.brand, category: t.category, outcome: t.outcome, notes: t.notes, rating: t.rating, finishedAt: t.finished_at })),
    });
  });

  api.put('/me/skills', auth('fixer'), (req, res) => {
    const skills = req.body?.skills;
    if (!Array.isArray(skills) || !skills.every(isCategory)) throw new HttpError(400, 'Unknown skill');
    const unique = [...new Set(skills)];
    db.prepare('UPDATE users SET skills = ? WHERE id = ?').run(JSON.stringify(unique), req.user.id);
    res.json({ skills: unique });
  });

  api.get('/events/:id/report', (req, res) => {
    const ev = getEvent(req.params.id);
    const tickets = db
      .prepare(
        `SELECT t.*, u.name AS fixer_name FROM tickets t LEFT JOIN users u ON u.id = t.fixer_id
          WHERE t.event_id = ? ORDER BY t.created_at`,
      )
      .all(ev.id);
    const team = new Map();
    for (const t of tickets) {
      if (t.status !== 'done' || !t.fixer_id) continue;
      const m = team.get(t.fixer_id) ?? { id: t.fixer_id, name: t.fixer_name, repairs: 0, fixed: 0 };
      m.repairs += 1;
      if (t.outcome === 'fixed' || t.outcome === 'partial') m.fixed += 1;
      team.set(t.fixer_id, m);
    }
    const rated = tickets.filter((t) => t.rating);
    res.json({
      event: ev,
      impact: summarize(tickets),
      checkedIn: tickets.length,
      typicalMinutes: typicalDurationMin(tickets.filter((t) => t.status === 'done')),
      rating: rated.length ? Math.round((rated.reduce((s, t) => s + t.rating, 0) / rated.length) * 100) / 100 : null,
      team: [...team.values()].sort((a, b) => b.fixed - a.fixed),
      items: tickets.map((t) => ({
        code: t.code, item: t.item, brand: t.brand, category: t.category, status: t.status, outcome: t.outcome,
        fixer: t.fixer_name ? firstName(t.fixer_name) : null, visitor: firstName(t.visitor_name),
      })),
    });
  });

  api.use((_req, _res) => {
    throw new HttpError(404, 'Not found');
  });

  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return app;
}

