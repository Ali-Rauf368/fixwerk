import { CATEGORIES } from './categories.js';

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Waste and CO2 avoided by one finished repair. A partial fix counts half. */
export function ticketImpact(ticket) {
  const cat = CATEGORIES[ticket.category];
  if (!cat || ticket.status !== 'done') return { kg: 0, co2: 0 };
  const share = ticket.outcome === 'fixed' ? 1 : ticket.outcome === 'partial' ? 0.5 : 0;
  const kg = (ticket.weight_kg ?? cat.avgWeightKg) * share;
  return { kg, co2: kg * cat.co2PerKg };
}

/** Aggregate impact and success rates for a list of tickets. */
export function summarize(tickets) {
  const done = tickets.filter((t) => t.status === 'done');
  const byCategory = {};
  let kg = 0;
  let co2 = 0;
  let fixed = 0;

  for (const t of done) {
    const imp = ticketImpact(t);
    const success = t.outcome === 'fixed' || t.outcome === 'partial';
    kg += imp.kg;
    co2 += imp.co2;
    if (success) fixed += 1;
    const c = (byCategory[t.category] ??= { category: t.category, repairs: 0, fixed: 0, kg: 0, co2: 0 });
    c.repairs += 1;
    if (success) c.fixed += 1;
    c.kg += imp.kg;
    c.co2 += imp.co2;
  }

  return {
    repairs: done.length,
    fixed,
    successRate: done.length ? round(fixed / done.length, 3) : 0,
    kgSaved: round(kg),
    co2SavedKg: round(co2),
    byCategory: Object.values(byCategory)
      .map((c) => ({ ...c, label: CATEGORIES[c.category]?.label ?? c.category, successRate: round(c.fixed / c.repairs, 3), kg: round(c.kg), co2: round(c.co2) }))
      .sort((a, b) => b.repairs - a.repairs),
  };
}
