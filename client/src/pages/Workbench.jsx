import { useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES, Category, ErrorNote, OUTCOMES, Spinner, fmtWait, minutesSince } from '../components/ui.jsx';
import { useApi, useAuth, useLiveEvent, useSocketEvent, useTick } from '../hooks.js';

export default function Workbench() {
  const events = useApi('/events');
  const live = events.data?.filter((e) => e.status === 'live') ?? [];
  const [chosen, setChosen] = useState(null);
  const eventId = chosen ?? live[0]?.id;

  if (events.loading) return <Spinner />;
  if (!live.length) return <div className="card text-center text-stone-500">No event is live right now. An organizer can start one under Organize.</div>;
  return (
    <div className="space-y-6">
      {live.length > 1 && (
        <select className="input max-w-xs" value={eventId} onChange={(e) => setChosen(Number(e.target.value))}>
          {live.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      )}
      <Bench eventId={eventId} />
    </div>
  );
}

function Bench({ eventId }) {
  const { user } = useAuth();
  const { data, error, reload } = useApi(`/events/${eventId}/workbench`);
  const connected = useLiveEvent(eventId, reload);
  const [actionError, setActionError] = useState(null);
  const [toasts, setToasts] = useState([]);
  useTick(30000);

  // Ping fixers when an item that matches their skills arrives (organizers see all).
  useSocketEvent(eventId, 'ticket:new', (msg) => {
    if (user.role === 'fixer' && !user.skills?.includes(msg.category)) return;
    setToasts((ts) => [...ts.slice(-2), msg]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x !== msg)), 8000);
  });

  const act = async (path, body) => {
    setActionError(null);
    try {
      await api(path, { method: 'POST', body });
    } catch (err) {
      setActionError(err);
    }
    reload();
  };

  if (!data) return error ? <ErrorNote error={error} /> : <Spinner />;
  const isOrganizer = user.role === 'organizer';
  const mine = data.inRepair.filter((t) => t.fixer_id === user.id);
  const others = data.inRepair.filter((t) => t.fixer_id !== user.id);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Workbench</h1>
          <p className="text-sm text-stone-500">{data.event.title} · {data.waiting.length} waiting · {data.inRepair.length} on the bench</p>
        </div>
        <span className={`text-xs ${connected ? 'text-brand-600' : 'text-stone-400'}`}>{connected ? '● synced live' : 'connecting…'}</span>
      </div>
      <ErrorNote error={actionError} />
      <div className="fixed right-4 bottom-4 z-20 space-y-2" aria-live="polite">
        {toasts.map((m) => (
          <div key={m.code} className="flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
            <span className="text-2xl" aria-hidden>{CATEGORIES[m.category]?.icon}</span>
            <div><b>New {user.role === 'fixer' ? 'match for you' : 'item'}:</b> {m.item}<div className="font-mono text-xs text-stone-400">{m.code}</div></div>
          </div>
        ))}
      </div>

      {!isOrganizer && (
        <section>
          <h2 className="mb-3 font-bold">My bench</h2>
          {mine.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {mine.map((t) => <FinishCard key={t.id} t={t} act={act} />)}
            </div>
          ) : (
            <p className="card text-sm text-stone-500">Nothing on your bench. Claim the next item below. Items marked ★ fit your skills.</p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-bold">Queue</h2>
        <div className="space-y-3">
          {data.waiting.map((t) => {
            const top = t.suggestions[0];
            const forMe = t.suggestions.find((s) => s.fixerId === user.id);
            return (
              <article key={t.id} className="card grid gap-4 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-stone-400">#{t.position} · {t.code}</span>
                    <h3 className="font-bold">{forMe && top?.fixerId === user.id && <span className="text-amber-500">★ </span>}{t.item}{t.brand && <span className="font-normal text-stone-500"> · {t.brand}</span>}</h3>
                    <Category value={t.category} />
                  </div>
                  <p className="mt-1 text-sm">{t.problem}</p>
                  <p className="mt-1 text-xs text-stone-500">{t.visitor_name} · waiting {minutesSince(t.created_at)} min · next in line {fmtWait(t.estimatedWaitMin)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {t.suggestions.map((s) => (
                      <span key={s.fixerId} title={s.reasons.join(' · ')} className={`rounded-lg border px-2 py-1 text-xs ${s.fixerId === user.id ? 'border-brand-500 bg-brand-50' : 'border-stone-200'}`}>
                        <b>{s.name.split(' ')[0]}</b> {s.score}
                        <span className="text-stone-500"> · {s.reasons[0]}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-2 md:flex-col md:items-end">
                  {isOrganizer ? (
                    t.suggestions.slice(0, 2).map((s) => (
                      <button key={s.fixerId} type="button" className="btn-ghost text-xs" onClick={() => act(`/tickets/${t.id}/assign`, { fixerId: s.fixerId })}>
                        Assign {s.name.split(' ')[0]}
                      </button>
                    ))
                  ) : (
                    <button type="button" className="btn-primary" onClick={() => act(`/tickets/${t.id}/claim`)}>Claim</button>
                  )}
                </div>
              </article>
            );
          })}
          {!data.waiting.length && <p className="card text-sm text-stone-500">The queue is empty 🎉</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-bold">{isOrganizer ? 'On the bench' : 'Other benches'}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(isOrganizer ? data.inRepair : others).map((t) =>
            isOrganizer ? <FinishCard key={t.id} t={t} act={act} /> : (
              <div key={t.id} className="card text-sm"><b>{t.item}</b> · {t.fixer_name} · {minutesSince(t.started_at)} min</div>
            ),
          )}
        </div>
      </section>
    </>
  );
}

function FinishCard({ t, act }) {
  const [outcome, setOutcome] = useState('fixed');
  const [notes, setNotes] = useState('');
  const [weightKg, setWeight] = useState('');
  return (
    <form
      className="card space-y-3 border-indigo-200"
      onSubmit={(e) => {
        e.preventDefault();
        act(`/tickets/${t.id}/finish`, { outcome, notes, weightKg });
      }}
    >
      <div className="flex justify-between gap-2">
        <div>
          <h3 className="font-bold">{t.item}{t.brand && ` · ${t.brand}`}</h3>
          <Category value={t.category} />
        </div>
        <span className="text-xs text-stone-500">{t.fixer_name?.split(' ')[0]} · {minutesSince(t.started_at)} min</span>
      </div>
      <p className="text-sm">{t.problem}</p>
      <div className="flex flex-wrap gap-1">
        {Object.entries(OUTCOMES).map(([k, o]) => (
          <button key={k} type="button" onClick={() => setOutcome(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${outcome === k ? o.cls + ' ring-2 ring-offset-1 ring-stone-400' : 'bg-stone-100 text-stone-500'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <textarea className="input" rows={2} maxLength={1000} placeholder="What did you do? (goes into the repair wiki)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <input className="input w-28" type="number" step="0.1" min="0.1" max="200" placeholder="kg (opt.)" value={weightKg} onChange={(e) => setWeight(e.target.value)} />
        <button className="btn-primary flex-1">Finish repair</button>
        <button type="button" className="btn-ghost" onClick={() => act(`/tickets/${t.id}/release`)}>Back to queue</button>
      </div>
    </form>
  );
}
