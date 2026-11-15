import { hashPassword } from './auth.js';
import { tx } from './db.js';

export const DEMO_PASSWORD = 'Fixwerk2026!';

const USERS = [
  ['Lena Hoffmann', 'lena@fixwerk.demo', 'organizer', []],
  ['Mehmet Yilmaz', 'mehmet@fixwerk.demo', 'fixer', ['electronics', 'appliances', 'computers']],
  ['Ingrid Bauer', 'ingrid@fixwerk.demo', 'fixer', ['textiles', 'toys']],
  ['Tomasz Nowak', 'tomasz@fixwerk.demo', 'fixer', ['bikes', 'furniture']],
  ['Aiko Tanaka', 'aiko@fixwerk.demo', 'fixer', ['computers', 'electronics', 'jewelry']],
  ['Jonas Weber', 'jonas@fixwerk.demo', 'fixer', ['appliances', 'bikes', 'furniture']],
];

// [item, brand, problem, repair note]
const ITEMS = {
  electronics: [
    ['Radio', 'Grundig', 'No sound, only crackling', 'Cold solder joint on the volume potentiometer reflowed'],
    ['Bluetooth speaker', 'JBL', 'Will not charge any more', 'Replaced worn micro-USB socket'],
    ['Turntable', 'Dual', 'Platter does not spin', 'Fitted a new drive belt and cleaned the motor pulley'],
    ['Headphones', 'Sennheiser', 'Left side cuts out', 'Cable break near the plug, shortened and re-soldered'],
  ],
  computers: [
    ['Laptop', 'Lenovo', 'Very slow and the fan is loud', 'Cleaned dust from fan, new thermal paste, swapped HDD for SSD'],
    ['Smartphone', 'Samsung', 'Battery drains in two hours', 'Battery replaced, visitor ordered the part in advance'],
    ['Printer', 'HP', 'Paper jams on every page', 'Cleaned and roughened the pickup rollers'],
    ['Tablet', 'Apple', 'Charging port loose', 'Removed lint from port, contacts fine again'],
  ],
  appliances: [
    ['Coffee machine', 'DeLonghi', 'Leaks water underneath', 'Replaced brittle O-ring on the brew unit, descaled'],
    ['Toaster', 'Severin', 'Lever will not stay down', 'Cleaned crumbs from the electromagnet, adjusted latch'],
    ['Vacuum cleaner', 'Bosch', 'Lost suction', 'Cleared a sock from the hose, new filter'],
    ['Hand mixer', 'Braun', 'Smells burnt, runs slowly', 'Worn carbon brushes replaced'],
  ],
  textiles: [
    ['Jeans', "Levi's", 'Torn at the knee', 'Patched from the inside with matching denim'],
    ['Winter jacket', 'Jack Wolfskin', 'Zipper splits open', 'Replaced the zipper slider, teeth were fine'],
    ['Backpack', 'Deuter', 'Shoulder strap ripped off', 'Re-stitched with a bar tack and webbing reinforcement'],
    ['Wool sweater', '—', 'Moth holes on the sleeve', 'Darned with matching yarn'],
  ],
  bikes: [
    ['City bike', 'Gazelle', 'Gears skip under load', 'Tensioned the cable and aligned the derailleur hanger'],
    ['Kids bike', 'Puky', 'Flat tyre', 'Patched inner tube, removed glass splinter from tyre'],
    ['E-bike', 'Cube', 'Brakes squeal', 'New brake pads, cleaned rotor with alcohol'],
  ],
  furniture: [
    ['Kitchen chair', 'IKEA', 'Wobbly legs', 'Re-glued the joints and clamped overnight'],
    ['Floor lamp', 'Vintage', 'Flickers when touched', 'New lamp socket and strain relief'],
    ['Drawer', '—', 'Runner broken', 'Replaced the plastic runner with a standard part'],
  ],
  toys: [
    ['Remote control car', 'Carrera', 'Steering does not react', 'Re-soldered a loose servo wire'],
    ['Teddy bear', 'Steiff', 'Seam opened, stuffing falls out', 'Hand-stitched with a ladder stitch'],
  ],
  jewelry: [
    ['Wristwatch', 'Casio', 'Stopped working', 'New battery and gasket'],
    ['Necklace', '—', 'Clasp broken', 'Fitted a new lobster clasp'],
  ],
};

const NOT_FIXABLE = ['Spare part no longer produced', 'Main board damaged by water', 'Repair would cost more than a used replacement'];
const ADVICE = ['Showed how to descale it at home', 'Gave the address of a specialist shop', 'Explained which spare part to order'];
const VISITORS = ['Anna', 'Ben', 'Clara', 'David', 'Elif', 'Felix', 'Greta', 'Hassan', 'Ida', 'Jan', 'Katrin', 'Luca', 'Mira', 'Noah', 'Olga', 'Paul', 'Rosa', 'Sami', 'Tara', 'Uwe', 'Vera', 'Yusuf', 'Zoe'];
const SURNAMES = ['Schmidt', 'Kaya', 'Fischer', 'Novak', 'Meyer', 'Rossi', 'Wagner', 'Becker', 'Lange', 'Haas'];

/** Small deterministic PRNG so the demo data is the same on every reset. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  const rand = mulberry32(2026);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const minutes = (m) => m * 60000;
  let codeSeq = 0;
  const code = () => `FX-${(1000 + (codeSeq += 7)).toString(36).toUpperCase().padStart(4, '2')}`;

  tx(db, () => {
    const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role, skills) VALUES (?, ?, ?, ?, ?)');
    const hash = hashPassword(DEMO_PASSWORD);
    const fixers = [];
    for (const [name, email, role, skills] of USERS) {
      const id = Number(insertUser.run(name, email, hash, role, JSON.stringify(skills)).lastInsertRowid);
      if (role === 'fixer') fixers.push({ id, skills });
    }

    const insertEvent = db.prepare('INSERT INTO events (title, location, starts_at, status) VALUES (?, ?, ?, ?)');
    const insertTicket = db.prepare(
      `INSERT INTO tickets (event_id, code, visitor_name, visitor_email, item, category, brand, problem, status, outcome,
                            fixer_id, weight_kg, notes, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const categories = Object.keys(ITEMS);
    const fixerFor = (category) => {
      const skilled = fixers.filter((f) => f.skills.includes(category));
      return pick(skilled.length && rand() < 0.85 ? skilled : fixers).id;
    };

    const addTicket = (eventId, created, state) => {
      const category = pick(categories);
      const [item, brand, problem, note] = pick(ITEMS[category]);
      const visitor = `${pick(VISITORS)} ${pick(SURNAMES)}`;
      let outcome = null;
      let notes = null;
      let fixerId = null;
      let started = null;
      let finished = null;
      if (state !== 'waiting') {
        fixerId = fixerFor(category);
        started = new Date(created.getTime() + minutes(5 + rand() * 30));
      }
      if (state === 'done') {
        finished = new Date(started.getTime() + minutes(12 + rand() * 40));
        const r = rand();
        outcome = r < 0.64 ? 'fixed' : r < 0.76 ? 'partial' : r < 0.85 ? 'advice' : 'not_fixable';
        notes = outcome === 'fixed' || outcome === 'partial' ? note : outcome === 'advice' ? pick(ADVICE) : pick(NOT_FIXABLE);
      }
      insertTicket.run(
        eventId, code(), visitor, null, item, category, brand === '—' ? null : brand, problem, state, outcome,
        fixerId, null, notes, created.toISOString(), started?.toISOString() ?? null, finished?.toISOString() ?? null,
      );
    };

    const today = new Date();
    const at = (monthsAgo, hour) => {
      const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 12, hour, 0, 0);
      return d;
    };
    const venues = ['Stadtteilzentrum Nord', 'Library Westend', 'Community Hall Südstadt'];
    for (let m = 6; m >= 1; m -= 1) {
      const start = at(m, 14);
      const id = Number(insertEvent.run(`Repair Café #${7 - m}`, pick(venues), start.toISOString(), 'closed').lastInsertRowid);
      const count = 18 + Math.floor(rand() * 14);
      for (let i = 0; i < count; i += 1) addTicket(id, new Date(start.getTime() + minutes(i * 6 + rand() * 5)), 'done');
    }

    const liveStart = new Date(Date.now() - minutes(95));
    const liveId = Number(insertEvent.run('Repair Café #7 – Live', 'Stadtteilzentrum Nord', liveStart.toISOString(), 'live').lastInsertRowid);
    // Fixed relative timestamps keep the live queue realistic.
    for (let i = 0; i < 6; i += 1) addTicket(liveId, new Date(liveStart.getTime() + minutes(i * 6)), 'done');
    for (let i = 0; i < 3; i += 1) {
      const created = new Date(Date.now() - minutes(55 - i * 8));
      addTicket(liveId, created, 'in_repair');
    }
    for (let i = 0; i < 7; i += 1) addTicket(liveId, new Date(Date.now() - minutes(30 - i * 4)), 'waiting');

    const next = new Date(today.getFullYear(), today.getMonth() + 1, 12, 14, 0, 0);
    insertEvent.run('Repair Café #8', 'Library Westend', next.toISOString(), 'planned');
  });

  // Deterministic visitor ratings for most finished repairs.
  db.exec(`UPDATE tickets SET rating = CASE outcome
             WHEN 'fixed' THEN 4 + (id % 4 > 0)
             WHEN 'partial' THEN 4
             WHEN 'advice' THEN 3 + (id % 2)
             ELSE 3 + (id % 3 = 0) END
           WHERE status = 'done' AND id % 5 != 0`);
  db.exec(`UPDATE tickets SET feedback = 'So happy it works again – thank you!' WHERE rating = 5 AND id % 7 = 0`);

  // In-repair seeds must not have started in the future.
  db.prepare(`UPDATE tickets SET started_at = ? WHERE status = 'in_repair' AND started_at > ?`).run(new Date().toISOString(), new Date().toISOString());
  return true;
}
