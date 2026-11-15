import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api.js';
import { CATEGORIES, ErrorNote, QR, Spinner, fmtPct, fmtWait } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const EMPTY = { visitorName: '', visitorEmail: '', item: '', brand: '', category: '', problem: '' };

export default function CheckIn() {
  const { eventId } = useParams();
  const events = useApi('/events');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [hint, setHint] = useState(null);
  const [pickedByHand, setPickedByHand] = useState(false);

  // Smart triage: as the visitor types, guess the category and forecast the repair.
  const description = `${form.item} ${form.brand} ${form.problem}`.trim();
  useEffect(() => {
    if (description.length < 4) return setHint(null);
    let alive = true;
    const t = setTimeout(() => {
      api(`/triage?text=${encodeURIComponent(description)}`)
        .then((h) => {
          if (!alive) return;
          setHint(h);
          if (!pickedByHand && h?.category && h.confidence >= 0.5) setForm((f) => ({ ...f, category: h.category }));
        })
        .catch(() => {});
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [description, pickedByHand]);
  const event = events.data?.find((e) => String(e.id) === eventId);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (events.loading) return <Spinner />;
  if (!event) return <ErrorNote error="This event does not exist." />;

  if (ticket) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <div className="text-5xl">🎟️</div>
        <h1 className="mt-2 text-2xl font-bold">You’re in the queue!</h1>
        <p className="mt-1 text-stone-500">Show this code at the bench when it’s called.</p>
        <div className="my-6 rounded-xl bg-stone-100 py-4 font-mono text-4xl font-bold tracking-widest">{ticket.code}</div>
        <QR value={`${window.location.origin}/status/${ticket.code}`} size={140} className="mx-auto mb-2" />
        <p className="mb-4 text-xs text-stone-500">Scan to follow your item on your phone</p>
        <p>Position <b>{ticket.position}</b> · estimated wait <b>{fmtWait(ticket.estimatedWaitMin)}</b></p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to={`/status/${ticket.code}`} className="btn-primary">Track live</Link>
          <button type="button" className="btn-ghost" onClick={() => { setTicket(null); setForm(EMPTY); setPickedByHand(false); setHint(null); }}>Check in another</button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card mx-auto max-w-2xl space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setTicket(await api(`/events/${eventId}/tickets`, { method: 'POST', body: form }));
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="text-2xl font-bold">Check in your item</h1>
        <p className="text-sm text-stone-500">{event.title} · {event.location}</p>
      </div>
      {event.status !== 'live' && <ErrorNote error="Check-in is only open while the event is live." />}


      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Item<input className="input mt-1" required maxLength={80} placeholder="e.g. Coffee machine" value={form.item} onChange={set('item')} /></label>
        <label className="text-sm font-medium">Brand (optional)<input className="input mt-1" maxLength={60} value={form.brand} onChange={set('brand')} /></label>
      </div>
      <label className="block text-sm font-medium">
        What’s wrong?
        <textarea className="input mt-1" required rows={3} maxLength={600} placeholder="When did it stop working? Any smell, noise, or error?" value={form.problem} onChange={set('problem')} />
      </label>
      {hint?.category && (
        <aside className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm" aria-live="polite">
          <div className="font-semibold text-brand-700">
            🔎 Looks like {CATEGORIES[hint.category].icon} {CATEGORIES[hint.category].label.toLowerCase()}
            {!pickedByHand && hint.confidence >= 0.5 && <span className="font-normal"> · selected for you</span>}
          </div>
          {hint.successChance != null ? (
            <p className="mt-1">
              We repaired <b>{hint.similarCount}</b> similar items before. Repair chance: <b>{fmtPct(hint.successChance)}</b>.
            </p>
          ) : (
            <p className="mt-1 text-stone-600">Not many similar repairs on record yet. Our fixers love a challenge!</p>
          )}
          {hint.tips.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-stone-600">
              {hint.tips.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          )}
        </aside>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Category</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(CATEGORIES).map(([key, c]) => (
            <label
              key={key}
              className={`cursor-pointer rounded-xl border p-3 text-center text-sm transition ${form.category === key ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-stone-200 hover:border-stone-400'}`}
            >
              <input type="radio" name="category" value={key} className="sr-only" checked={form.category === key} onChange={(e) => { setPickedByHand(true); set('category')(e); }} />
              <div className="text-2xl" aria-hidden>{c.icon}</div>
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Your name<input className="input mt-1" required maxLength={80} value={form.visitorName} onChange={set('visitorName')} /></label>
        <label className="text-sm font-medium">Email (optional)<input type="email" className="input mt-1" maxLength={160} value={form.visitorEmail} onChange={set('visitorEmail')} /></label>
      </div>
      <p className="text-xs text-stone-500">Only your first name appears on the public board.</p>
      <ErrorNote error={error} />
      <button className="btn-primary w-full" disabled={busy || !form.category || event.status !== 'live'}>
        {busy ? 'Checking in…' : 'Get my ticket'}
      </button>
    </form>
  );
}
