import { useEffect, useState } from 'react';
import { CATEGORIES, Category, ErrorNote, OUTCOMES, Pill, fmtDate } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

export default function Knowledge() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams({ q: debounced, ...(category && { category }) });
  const { data, error } = useApi(`/knowledge?${params}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Repair wiki</h1>
        <p className="text-sm text-stone-500">Every finished repair becomes a searchable note, so the next fixer doesn’t start from zero.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-sm" placeholder="Search: zipper, Bosch, won't charge…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[14rem]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
      </div>
      <ErrorNote error={error} />
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((r) => (
          <article key={r.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold">{r.item}{r.brand && <span className="font-normal text-stone-500"> · {r.brand}</span>}</h3>
                <Category value={r.category} />
              </div>
              <Pill cls={OUTCOMES[r.outcome].cls}>{OUTCOMES[r.outcome].label}</Pill>
            </div>
            <p className="mt-3 text-sm"><span className="font-semibold text-stone-500">Problem:</span> {r.problem}</p>
            <p className="mt-1 text-sm"><span className="font-semibold text-stone-500">Solution:</span> {r.notes}</p>
            <p className="mt-3 text-xs text-stone-400">{r.fixer} · {fmtDate(r.finished_at)}</p>
          </article>
        ))}
        {data && !data.length && <p className="text-stone-500">No repairs found.</p>}
      </div>
    </div>
  );
}
