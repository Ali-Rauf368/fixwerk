import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CATEGORIES, ErrorNote, OUTCOMES, Pill, STATUS, Spinner, StatTile, fmtDate, fmtNum, fmtPct } from '../components/ui.jsx';
import { useApi } from '../hooks.js';
import { Avatar } from './Volunteers.jsx';

export default function EventReport() {
  const { id } = useParams();
  const { data, error } = useApi(`/events/${id}/report`);
  const [filter, setFilter] = useState('all');
  if (error) return <div className="space-y-4"><ErrorNote error={error} /><Link to="/" className="btn-ghost">All events</Link></div>;
  if (!data) return <Spinner />;
  const { event, impact, team, items } = data;
  const shown = filter === 'all' ? items : items.filter((i) => (filter === 'open' ? i.status !== 'done' : i.outcome === filter));
  const maxCat = Math.max(1, ...impact.byCategory.map((c) => c.repairs));

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-stone-500 hover:text-ink">← All events</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{event.title}</h1>
          <p className="text-stone-500">{fmtDate(event.starts_at)} · {event.location}</p>
        </div>
        <div className="flex gap-2">
          {event.status === 'live' && <Link to={`/checkin/${event.id}`} className="btn-primary">Check in an item</Link>}
          {event.status === 'live' && <Link to={`/board/${event.id}`} className="btn-ghost">Live board ↗</Link>}
        </div>
      </header>

      {event.status === 'planned' ? (
        <div className="card text-center text-stone-500">This event hasn’t started yet. Check-in opens on the day. 🗓️</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Items checked in" value={data.checkedIn} />
            <StatTile label="Success rate" value={fmtPct(impact.successRate)} hint={`${impact.fixed} of ${impact.repairs} finished`} />
            <StatTile label="Waste avoided" value={`${fmtNum(impact.kgSaved, 1)} kg`} />
            <StatTile label="CO₂e avoided" value={`${fmtNum(impact.co2SavedKg)} kg`} hint="estimate" />
            <StatTile label="Visitor rating" value={data.rating ? `${data.rating.toFixed(1)} ★` : '—'} hint={`typical repair ${data.typicalMinutes} min`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="mb-4 font-bold">What came in</h2>
              <ul className="space-y-2">
                {impact.byCategory.map((c) => (
                  <li key={c.category} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm">
                    <span className="truncate">{CATEGORIES[c.category]?.icon} {c.label}</span>
                    <span className="h-3 rounded-full bg-stone-100">
                      <span className="flex h-full rounded-full bg-stone-300" style={{ width: `${(c.repairs / maxCat) * 100}%` }}>
                        <span className="h-full rounded-full bg-brand-500" style={{ width: `${c.successRate * 100}%` }} />
                      </span>
                    </span>
                    <span className="text-right tabular-nums text-stone-600">{c.fixed}/{c.repairs}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <h2 className="mb-4 font-bold">The team</h2>
              <ul className="space-y-3">
                {team.map((m) => (
                  <li key={m.id}>
                    <Link to={`/volunteers/${m.id}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-stone-50">
                      <Avatar id={m.id} name={m.name} size="h-9 w-9 text-sm" />
                      <span className="flex-1 font-medium">{m.name}</span>
                      <span className="text-sm tabular-nums text-stone-600">{m.fixed} / {m.repairs} repaired</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">All items ({shown.length})</h2>
              <div className="flex flex-wrap gap-1">
                {[['all', 'All'], ['fixed', 'Fixed'], ['partial', 'Partly'], ['advice', 'Advice'], ['not_fixable', 'Not fixable'], ['open', 'Open']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === k ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-stone-500"><tr><th className="pb-2">Item</th><th className="pb-2">Category</th><th className="pb-2">Visitor</th><th className="pb-2">Fixer</th><th className="pb-2 text-right">Result</th></tr></thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.code} className="border-t border-stone-100">
                      <td className="py-2"><b>{i.item}</b>{i.brand && <span className="text-stone-500"> · {i.brand}</span>}</td>
                      <td className="py-2">{CATEGORIES[i.category]?.icon} {CATEGORIES[i.category]?.label}</td>
                      <td className="py-2">{i.visitor}</td>
                      <td className="py-2">{i.fixer ?? '—'}</td>
                      <td className="py-2 text-right">{i.outcome ? <Pill cls={OUTCOMES[i.outcome].cls}>{OUTCOMES[i.outcome].label}</Pill> : <Pill cls={STATUS[i.status].cls}>{STATUS[i.status].label}</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
