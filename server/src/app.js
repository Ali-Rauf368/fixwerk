import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { signToken, verifyPassword, verifyToken } from './auth.js';
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
  const fixersWithLoad = () =>
    db
      .prepare(
        `SELECT u.id, u.name, u.skills,
                (SELECT COUNT(*) FROM tickets t WHERE t.fixer_id = u.id AND t.status = 'in_repair') AS activeCount
           FROM users u WHERE u.role = 'fixer' ORDER BY u.name`,
      )
      .all()
      .map((f) => ({ ...f, skills: JSON.parse(f.skills) }));
  const history = () =>
    db.prepare(`SELECT fixer_id, category, outcome, started_at, finished_at FROM tickets WHERE status = 'done'`).all();

  /** Waiting queue (FIFO) with position and estimated wait for an event. */
  const queueFor = (eventId) => {
    const waiting = db
      .prepare(`SELECT * FROM tickets WHERE event_id = ? AND status = 'waiting' ORDER BY created_at, id`)
      .all(eventId);
    const duration = typicalDurationMin(history());
    const fixerCount = fixersWithLoad().length;
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
                SUM(t.status = 'done' AND t.outcome IN ('fixed', 'partial')) AS fixed
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
    db.prepare(
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
    res.status(201).json({ ok: true });
  });

  // ---------- workbench (fixers & organizers) ----------
  api.get('/events/:id/workbench', auth('fixer', 'organizer'), (req, res) => {
    const ev = getEvent(req.params.id);
    const fixers = fixersWithLoad();
    const hist = history();
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
    });
  });

  const startRepair = (ticket, fixerId) => {
    const ev = getEvent(ticket.event_id);
    if (ev.status !== 'live') throw new HttpError(409, 'The event is not live');
    const fixer = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'fixer'`).get(Number(fixerId));
    if (!fixer) throw new HttpError(400, 'Unknown fixer');
    // Conditional update so two fixers cannot grab the same ticket.
    const { changes } = db
      .prepare(`UPDATE tickets SET status = 'in_repair', fixer_id = ?, started_at = ? WHERE id = ? AND status = 'waiting'`)
      .run(fixer.id, now(), ticket.id);
    if (!changes) throw new HttpError(409, 'Someone else already took this item');
    notify(ticket.event_id);
  };

  api.post('/tickets/:id/claim', auth('fixer'), (req, res) => {
    const t = getTicket(req.params.id);
    startRepair(t, req.user.id);
    res.json(getTicket(t.id));
  });

  api.post('/tickets/:id/assign', auth('organizer'), (req, res) => {
    const t = getTicket(req.params.id);
    startRepair(t, req.body?.fixerId);
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
    db.prepare(`UPDATE tickets SET status = 'done', outcome = ?, notes = ?, weight_kg = ?, finished_at = ? WHERE id = ?`).run(
      outcome,
      text(req.body?.notes, 'Notes', { max: 1000, required: false }),
      weight,
      now(),
      t.id,
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

  // ---------- volunteers & event reports ----------
  const fixerStats = db.prepare(
    `SELECT u.id, u.name, u.skills,
            COUNT(t.id) AS repairs,
            COALESCE(SUM(t.outcome IN ('fixed', 'partial')), 0) AS fixed,
            ROUND(AVG(t.rating), 2) AS rating, COUNT(t.rating) AS ratings
       FROM users u LEFT JOIN tickets t ON t.fixer_id = u.id AND t.status = 'done'
      WHERE u.role = 'fixer' AND (? IS NULL OR u.id = ?)
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

