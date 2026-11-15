import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../hooks.js';
import { ErrorNote, Pill, Spinner, fmtDate, fmtNum } from '../components/ui.jsx';

const EVENT_STATUS = {
  live: { label: '● Live now', cls: 'bg-red-100 text-red-700' },
  planned: { label: 'Upcoming', cls: 'bg-sky-100 text-sky-800' },
  closed: { label: 'Closed', cls: 'bg-stone-200 text-stone-600' },
};

export default function Home() {
  const events = useApi('/events');
  const stats = useApi('/stats');
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const live = events.data?.filter((e) => e.status === 'live') ?? [];
  const total = stats.data?.total;

  return (
    <div className="space-y-10">
      <section className="grid gap-8 rounded-3xl bg-gradient-to-br from-brand-700 to-emerald-900 p-8 text-white md:grid-cols-[1.4fr_1fr] md:p-12">
        <div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">Don’t throw it away.<br />Bring it to the bench.</h1>
          <p className="mt-4 max-w-xl text-brand-100">
            Fixwerk runs community repair cafés: visitors check in their broken things, volunteers get matched by skill,
            and everyone can watch the queue and the impact live.
          </p>
          {total && (
            <div className="mt-8 flex flex-wrap gap-8">
              {[
                [fmtNum(total.repairs), 'repairs attempted'],
                [fmtNum(total.kgSaved), 'kg kept out of the bin'],
                [fmtNum(total.co2SavedKg / 1000, 1) + ' t', 'CO₂e avoided (estimate)'],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="text-3xl font-bold tabular-nums">{v}</div>
                  <div className="text-sm text-brand-100">{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <form
          className="self-end rounded-2xl bg-white/10 p-5 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) navigate(`/status/${encodeURIComponent(code.trim().toUpperCase())}`);
          }}
        >
          <label htmlFor="code" className="text-sm font-semibold">Already checked in? Track your item</label>
          <div className="mt-2 flex gap-2">
            <input id="code" className="input text-ink" placeholder="FX-ABCD" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn bg-white text-brand-700 hover:bg-brand-50">Track</button>
          </div>
        </form>
      </section>

      {live.map((e) => (
        <section key={e.id} className="card flex flex-wrap items-center gap-4 border-red-200">
          <div className="flex-1">
            <Pill cls={EVENT_STATUS.live.cls}>{EVENT_STATUS.live.label}</Pill>
            <h2 className="mt-2 text-xl font-bold">{e.title}</h2>
            <p className="text-sm text-stone-500">{e.location} · {e.waiting} waiting · {e.fixed} fixed so far</p>
          </div>
          <Link to={`/checkin/${e.id}`} className="btn-primary">Check in an item</Link>
          <Link to={`/board/${e.id}`} className="btn-ghost">Open live board ↗</Link>
        </section>
      ))}

      <section>
        <h2 className="mb-4 text-lg font-bold">All events</h2>
        <ErrorNote error={events.error} />
        {events.loading ? (
          <Spinner />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.data?.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="card block transition hover:-translate-y-0.5 hover:shadow-md">
                <Pill cls={EVENT_STATUS[e.status].cls}>{EVENT_STATUS[e.status].label}</Pill>
                <h3 className="mt-2 font-bold">{e.title}</h3>
                <p className="text-sm text-stone-500">{fmtDate(e.starts_at)} · {e.location}</p>
                <p className="mt-3 text-sm">
                  {e.status === 'planned' ? 'Check-in opens on the day' : `${e.tickets} items · ${e.fixed} repaired`}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
