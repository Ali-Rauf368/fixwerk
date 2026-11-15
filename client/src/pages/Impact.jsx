import { Link } from 'react-router';
import { CATEGORIES, ErrorNote, Spinner, StatTile, Stars, fmtDate, fmtNum, fmtPct } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

export default function Impact() {
  const { data, error } = useApi('/stats');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const { total, perEvent, fixers, rating, durationByCategory, recentFeedback } = data;
  const maxMin = Math.max(1, ...durationByCategory.map((d) => d.minutes));
  const maxRepairs = Math.max(1, ...perEvent.map((e) => e.repairs));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Impact</h1>
        <p className="text-sm text-stone-500">Across all events so far. CO₂ figures are estimates from average item weight and embodied emissions per category.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Repairs attempted" value={fmtNum(total.repairs)} />
        <StatTile label="Success rate" value={fmtPct(total.successRate)} hint="fixed or partly fixed" />
        <StatTile label="Waste avoided" value={`${fmtNum(total.kgSaved)} kg`} />
        <StatTile label="CO₂e avoided" value={`${fmtNum(total.co2SavedKg)} kg`} hint="estimate" />
        <StatTile label="Visitor rating" value={`${fmtNum(rating.avg, 1)} ★`} hint={`${rating.count} ratings`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-4 font-bold">Repairs per event</h2>
          <ul className="space-y-3">
            {perEvent.map((e) => (
              <li key={e.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium"><Link to={`/events/${e.id}`} className="hover:text-brand-700 hover:underline">{e.title}</Link> <span className="text-stone-400">· {fmtDate(e.startsAt)}</span></span>
                  <span className="tabular-nums text-stone-600">{e.fixed} / {e.repairs}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={`${e.fixed} of ${e.repairs} repaired`}>
                  <div className="h-full rounded-full bg-stone-300" style={{ width: `${(e.repairs / maxRepairs) * 100}%` }}>
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${e.repairs ? (e.fixed / e.repairs) * 100 : 0}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-stone-500"><span className="inline-block h-2 w-3 rounded bg-brand-500" /> repaired <span className="ml-3 inline-block h-2 w-3 rounded bg-stone-300" /> attempted</p>
        </section>

        <section className="card">
          <h2 className="mb-4 font-bold">Success rate by category</h2>
          <ul className="space-y-3">
            {total.byCategory.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{CATEGORIES[c.category]?.icon} {c.label}</span>
                  <span className="tabular-nums text-stone-600">{fmtPct(c.successRate)} · {c.repairs} items · {fmtNum(c.kg)} kg</span>
                </div>
                <div className="mt-1 h-2.5 rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${c.successRate * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-bold">Typical repair time</h2>
          <p className="mb-4 text-xs text-stone-500">Median minutes on the bench, by category</p>
          <ul className="space-y-2">
            {durationByCategory.map((d) => (
              <li key={d.category} className="grid grid-cols-[10rem_1fr_3.5rem] items-center gap-3 text-sm">
                <span className="truncate">{CATEGORIES[d.category]?.icon} {d.label}</span>
                <span className="h-2.5 rounded-full bg-stone-100"><span className="block h-full rounded-full bg-indigo-400" style={{ width: `${(d.minutes / maxMin) * 100}%` }} /></span>
                <span className="text-right tabular-nums text-stone-600">{d.minutes} min</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-4 font-bold">What visitors say</h2>
          <ul className="space-y-3">
            {recentFeedback.map((f, i) => (
              <li key={i} className="rounded-lg bg-stone-50 p-3 text-sm">
                <div className="flex justify-between"><b>{f.item}</b><Stars value={f.rating} size="text-sm" /></div>
                <p className="mt-1 text-stone-600">“{f.feedback}”</p>
              </li>
            ))}
            {!recentFeedback.length && <li className="text-sm text-stone-500">No written feedback yet.</li>}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 className="mb-4 font-bold">Volunteer fixers</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500"><tr><th className="pb-2">Fixer</th><th className="pb-2 text-right">Repairs</th><th className="pb-2 text-right">Successful</th><th className="pb-2 text-right">Rate</th><th className="pb-2 text-right">Rating</th></tr></thead>
          <tbody>
            {fixers.map((f) => (
              <tr key={f.id} className="border-t border-stone-100">
                <td className="py-2 font-medium"><Link to={`/volunteers/${f.id}`} className="hover:text-brand-700 hover:underline">{f.name}</Link></td>
                <td className="py-2 text-right tabular-nums">{f.repairs}</td>
                <td className="py-2 text-right tabular-nums">{f.fixed}</td>
                <td className="py-2 text-right tabular-nums">{fmtPct(f.fixed / f.repairs)}</td>
                <td className="py-2 text-right tabular-nums">{f.rating ? `${fmtNum(f.rating, 1)} ★` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
