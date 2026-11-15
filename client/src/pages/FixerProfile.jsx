import { Link, useParams } from 'react-router';
import { CATEGORIES, Category, ErrorNote, OUTCOMES, Pill, Spinner, StatTile, Stars, fmtDate, fmtNum, fmtPct } from '../components/ui.jsx';
import { useApi } from '../hooks.js';
import { Avatar } from './Volunteers.jsx';

export default function FixerProfile() {
  const { id } = useParams();
  const { data: f, error } = useApi(`/fixers/${id}`);
  if (error) return <div className="space-y-4"><ErrorNote error={error} /><Link to="/volunteers" className="btn-ghost">All volunteers</Link></div>;
  if (!f) return <Spinner />;

  return (
    <div className="space-y-6">
      <Link to="/volunteers" className="text-sm text-stone-500 hover:text-ink">← All volunteers</Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar id={f.id} name={f.name} size="h-20 w-20 text-2xl" />
        <div>
          <h1 className="text-3xl font-bold">{f.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1">
            {f.skills.map((s) => <span key={s} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{CATEGORIES[s]?.icon} {CATEGORIES[s]?.label}</span>)}
          </div>
        </div>
        {f.rating && <div className="ml-auto text-right"><Stars value={f.rating} /><div className="text-xs text-stone-500">{f.rating.toFixed(1)} from {f.ratings} visitors</div></div>}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Repairs" value={f.repairs} hint={`across ${f.events} events`} />
        <StatTile label="Success rate" value={f.repairs ? fmtPct(f.fixed / f.repairs) : '—'} hint={`${f.fixed} fixed or partly fixed`} />
        <StatTile label="Waste avoided" value={`${fmtNum(f.kgSaved)} kg`} hint={`${fmtNum(f.co2SavedKg)} kg CO₂e (estimate)`} />
        <StatTile label="Typical repair" value={f.typicalMinutes ? `${f.typicalMinutes} min` : '—'} hint="median time on the bench" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="card">
          <h2 className="mb-4 font-bold">Strengths</h2>
          <ul className="space-y-3">
            {f.byCategory.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between text-sm">
                  <span>{CATEGORIES[c.category]?.icon} {c.label}</span>
                  <span className="tabular-nums text-stone-600">{c.fixed}/{c.repairs} · {fmtPct(c.successRate)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-stone-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${c.successRate * 100}%` }} /></div>
              </li>
            ))}
            {!f.byCategory.length && <li className="text-sm text-stone-500">No repairs yet.</li>}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-4 font-bold">Recent repairs</h2>
          <ul className="divide-y divide-stone-100">
            {f.recent.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <b>{r.item}</b>{r.brand && <span className="text-stone-500"> · {r.brand}</span>}
                    <div><Category value={r.category} /> <span className="text-xs text-stone-400">· {fmtDate(r.finishedAt)}</span></div>
                  </div>
                  <Pill cls={OUTCOMES[r.outcome].cls}>{OUTCOMES[r.outcome].label}</Pill>
                </div>
                {r.notes && <p className="mt-1 text-sm text-stone-600">{r.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
