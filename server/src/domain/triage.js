const STOP = new Set(
  'the and not does doesnt will wont any more when with from into very only just also after before keeps cant can its'.split(' '),
);

// Strong hints from common item words. History votes are added on top.
const KEYWORDS = {
  electronics: ['radio', 'speaker', 'amplifier', 'headphones', 'turntable', 'television', 'stereo', 'hifi', 'record', 'player', 'bluetooth'],
  computers: ['laptop', 'computer', 'phone', 'smartphone', 'tablet', 'printer', 'monitor', 'keyboard', 'mouse', 'ipad', 'iphone', 'macbook'],
  appliances: ['coffee', 'toaster', 'kettle', 'vacuum', 'mixer', 'blender', 'iron', 'hairdryer', 'microwave', 'espresso', 'juicer'],
  textiles: ['jeans', 'jacket', 'shirt', 'zipper', 'sweater', 'dress', 'trousers', 'backpack', 'bag', 'seam', 'button', 'coat', 'wool'],
  bikes: ['bike', 'bicycle', 'tyre', 'tire', 'chain', 'brake', 'brakes', 'gears', 'saddle', 'ebike', 'derailleur', 'puncture'],
  furniture: ['chair', 'table', 'lamp', 'drawer', 'shelf', 'sofa', 'cabinet', 'stool', 'wobbly'],
  toys: ['toy', 'teddy', 'doll', 'lego', 'puzzle', 'remote', 'plush'],
  jewelry: ['watch', 'wristwatch', 'necklace', 'ring', 'bracelet', 'earring', 'clasp', 'jewelry', 'jewellery'],
};

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const isSuccess = (o) => o === 'fixed' || o === 'partial';

/**
 * Guess the category of a new item and forecast its repair chances from past repairs.
 * Similarity is Jaccard overlap of word sets; the forecast is a Laplace-smoothed
 * success rate over the most similar past repairs in the guessed category.
 *
 * @param {string} text item, brand and problem description
 * @param {{item: string, brand?: string, problem: string, category: string, outcome: string, notes?: string}[]} history
 */
export function triage(text, history) {
  const tokens = new Set(tokenize(text));
  if (!tokens.size) return null;

  const votes = {};
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const w of words) if (tokens.has(w)) votes[cat] = (votes[cat] ?? 0) + 2;
  }

  const similar = history
    .map((h) => {
      const other = new Set(tokenize(`${h.item} ${h.brand ?? ''} ${h.problem}`));
      let shared = 0;
      for (const t of tokens) if (other.has(t)) shared += 1;
      return { h, sim: shared / (tokens.size + other.size - shared) };
    })
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 20);
  for (const { h, sim } of similar) votes[h.category] = (votes[h.category] ?? 0) + sim * 3;

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const category = ranked[0]?.[0] ?? null;
  const confidence = total ? Math.round((ranked[0][1] / total) * 100) / 100 : 0;

  const relevant = similar.filter((x) => x.h.category === category);
  const wins = relevant.filter((x) => isSuccess(x.h.outcome)).length;
  const successChance = relevant.length >= 3 ? Math.round(((wins + 1) / (relevant.length + 2)) * 100) / 100 : null;
  const tips = [...new Set(relevant.filter((x) => isSuccess(x.h.outcome) && x.h.notes).map((x) => x.h.notes))].slice(0, 3);

  return { category, confidence, successChance, similarCount: relevant.length, tips };
}
