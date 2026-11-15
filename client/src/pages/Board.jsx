import { useParams } from 'react-router';
import { CATEGORIES, OUTCOMES, QR, fmtNum, fmtPct, fmtWait, minutesSince } from '../components/ui.jsx';
import { useApi, useLiveEvent, useTick } from '../hooks.js';

/** Full-screen display for a TV at the venue. */
export default function Board() {
  const { eventId } = useParams();
  const { data, reload } = useApi(`/events/${eventId}/board`);
  const live = useLiveEvent(eventId, reload);
  useTick(30000);

  if (!data) return <div className="grid min-h-screen place-items-center bg-ink text-stone-400">Loading board…</div>;
  const { event, waiting, inRepair, done, impact } = data;

  return (
    <div className="min-h-screen bg-ink p-6 text-white lg:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-widest text-brand-500">🔧 Fixwerk · {event.location}</div>
          <h1 className="text-4xl font-extrabold">{event.title}</h1>
        </div>
        <div className="flex gap-8 text-right">
          {[
            [fmtNum(impact.fixed), 'repaired today'],
            [fmtPct(impact.successRate), 'success rate'],
            [`${fmtNum(impact.kgSaved, 1)} kg`, 'saved from waste'],
          ].map(([v, l]) => (
            <div key={l}><div className="text-3xl font-bold tabular-nums text-brand-500">{v}</div><div className="text-xs text-stone-400">{l}</div></div>
          ))}
          <div className={`self-center text-xs ${live ? 'text-brand-500' : 'text-red-400'}`}>{live ? '● LIVE' : '○ reconnecting'}</div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <Column title="Waiting" count={waiting.length}>
          {waiting.map((t) => (
            <Row key={t.code} t={t} right={<span className="text-stone-300">#{t.position} · {fmtWait(t.estimatedWaitMin)}</span>} />
          ))}
        </Column>
        <Column title="On the bench" count={inRepair.length} accent>
          {inRepair.map((t) => (
            <Row key={t.code} t={t} right={<span className="text-indigo-300">{t.fixer} · {minutesSince(t.startedAt)} min</span>} />
          ))}
        </Column>
        <Column title="Recently finished" count={impact.repairs}>
          {done.map((t) => (
            <Row key={t.code} t={t} right={<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOMES[t.outcome].cls}`}>{OUTCOMES[t.outcome].label}</span>} />
          ))}
        </Column>
      </div>
      <footer className="mt-8 flex items-center justify-center gap-5">
        <QR value={`${window.location.origin}/checkin/${event.id}`} size={96} className="overflow-hidden rounded-lg" />
        <div>
          <div className="text-lg font-bold">Scan to check in your item</div>
          <div className="text-sm text-stone-400">No app needed. You’ll get a ticket code and can follow the queue on your phone.</div>
        </div>
      </footer>
    </div>
  );
}

function Column({ title, count, accent, children }) {
  return (
    <section className={`rounded-2xl p-4 ${accent ? 'bg-indigo-950/60 ring-1 ring-indigo-500/40' : 'bg-white/5'}`}>
      <h2 className="mb-3 flex items-center justify-between text-lg font-bold">{title}<span className="rounded-full bg-white/10 px-2 text-sm">{count}</span></h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Row({ t, right }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
      <span className="text-2xl" aria-hidden>{CATEGORIES[t.category]?.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{t.item}</div>
        <div className="font-mono text-xs text-stone-400">{t.code} · {t.visitor}</div>
      </div>
      <div className="shrink-0 text-sm">{right}</div>
    </li>
  );
}
