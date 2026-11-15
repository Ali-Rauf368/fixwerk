import { CATEGORIES } from './categories.js';

const isSuccess = (o) => o === 'fixed' || o === 'partial';

/**
 * Rank fixers for a ticket. Score 0–100 from four signals:
 *  - skill match for the category        (45)
 *  - smoothed success rate in category   (30)  Laplace (wins+1)/(n+2), so no history = 50 %
 *  - experience in category, capped at 10 (15)
 *  - free capacity (0, 1 or 2+ active)   (10)
 *
 * @param {{category: string}} ticket
 * @param {{id: number, name: string, skills: string[], activeCount: number}[]} fixers
 * @param {{fixer_id: number, category: string, outcome: string}[]} history finished tickets
 */
export function rankFixers(ticket, fixers, history) {
  return fixers
    .map((f) => {
      const past = history.filter((h) => h.fixer_id === f.id && h.category === ticket.category);
      const wins = past.filter((h) => isSuccess(h.outcome)).length;
      const hasSkill = f.skills.includes(ticket.category);
      const rate = (wins + 1) / (past.length + 2);
      const experience = Math.min(past.length, 10) / 10;
      const capacity = 1 - Math.min(f.activeCount, 2) / 2;
      const score = Math.round(45 * (hasSkill ? 1 : 0) + 30 * rate + 15 * experience + 10 * capacity);

      const reasons = [];
      const label = CATEGORIES[ticket.category]?.label ?? ticket.category;
      if (hasSkill) reasons.push(`Skilled in ${label.toLowerCase()}`);
      if (past.length) reasons.push(`${wins}/${past.length} past ${label.toLowerCase()} repairs succeeded`);
      reasons.push(f.activeCount ? `Working on ${f.activeCount} item${f.activeCount > 1 ? 's' : ''}` : 'Free right now');
      return { fixerId: f.id, name: f.name, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Median repair duration in minutes from finished tickets (default 25). */
export function typicalDurationMin(history) {
  const mins = history
    .filter((h) => h.started_at && h.finished_at)
    .map((h) => (Date.parse(h.finished_at) - Date.parse(h.started_at)) / 60000)
    .filter((m) => m > 0)
    .sort((a, b) => a - b);
  if (!mins.length) return 25;
  const mid = Math.floor(mins.length / 2);
  return Math.round(mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2);
}

/** Estimated wait for the ticket at 1-based queue `position`. */
export function estimateWaitMin(position, fixerCount, durationMin) {
  if (position <= 0) return 0;
  return Math.ceil(position / Math.max(1, fixerCount)) * durationMin;
}
