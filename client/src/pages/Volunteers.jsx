import { Link } from 'react-router';
import { CATEGORIES, ErrorNote, Spinner, Stars, fmtPct } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

export const initials = (name) => name.split(' ').map((p) => p[0]).join('').slice(0, 2);
const HUES = ['bg-emerald-600', 'bg-indigo-600', 'bg-amber-600', 'bg-rose-600', 'bg-sky-600', 'bg-violet-600'];
export const Avatar = ({ id, name, size = 'h-12 w-12 text-base' }) => (
  <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${size} ${HUES[id % HUES.length]}`}>{initials(name)}</span>
);

export default function Volunteers() {
  const { data, error } = useApi('/fixers');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Our volunteers</h1>
        <p className="text-sm text-stone-500">The people behind every second life. {data.length} fixers, {data.reduce((s, f) => s + f.fixed, 0)} successful repairs.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((f) => (
          <Link key={f.id} to={`/volunteers/${f.id}`} className="card block transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center gap-3">
              <Avatar id={f.id} name={f.name} />
              <div>
                <h2 className="font-bold">{f.name}</h2>
                {f.rating ? <span className="flex items-center gap-1 text-xs text-stone-500"><Stars value={f.rating} size="text-sm" /> {f.rating.toFixed(1)}</span> : <span className="text-xs text-stone-400">No ratings yet</span>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1">
              {f.skills.map((s) => <span key={s} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{CATEGORIES[s]?.icon} {CATEGORIES[s]?.label}</span>)}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center text-sm">
              <div><div className="font-bold tabular-nums">{f.repairs}</div><div className="text-xs text-stone-500">repairs</div></div>
              <div><div className="font-bold tabular-nums">{f.fixed}</div><div className="text-xs text-stone-500">successful</div></div>
              <div><div className="font-bold tabular-nums">{f.repairs ? fmtPct(f.fixed / f.repairs) : '—'}</div><div className="text-xs text-stone-500">rate</div></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
