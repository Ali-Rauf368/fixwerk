import { useState } from 'react';
import { Link } from 'react-router';
import { api, tokenStore } from '../api.js';
import { ErrorNote, Pill, Spinner, fmtDate } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const NEXT = { planned: ['live', 'Start event'], live: ['closed', 'Close event'], closed: ['live', 'Reopen'] };

export default function Organizer() {
  const events = useApi('/events');
  const [form, setForm] = useState({ title: '', location: '', startsAt: '' });
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setError(null);
    try {
      await fn();
      events.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold">Events</h1>
        <ErrorNote error={error} />
        {events.loading ? <Spinner /> : events.data.map((e) => (
          <div key={e.id} className="card flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-bold">{e.title}</h2>
                <Pill cls={e.status === 'live' ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-600'}>{e.status}</Pill>
              </div>
              <p className="text-sm text-stone-500">{fmtDate(e.starts_at)} · {e.location} · {e.tickets} items</p>
            </div>
            {e.tickets > 0 && (
              <button type="button" className="btn-ghost text-xs" onClick={() => run(() => downloadCsv(e))}>Export CSV</button>
            )}
            {e.status === 'live' && <Link to={`/board/${e.id}`} className="btn-ghost text-xs">Board ↗</Link>}
            <button type="button" className="btn-ghost text-xs" onClick={() => run(() => api(`/events/${e.id}`, { method: 'PATCH', body: { status: NEXT[e.status][0] } }))}>
              {NEXT[e.status][1]}
            </button>
          </div>
        ))}
      </section>

      <form
        className="card h-fit space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api('/events', { method: 'POST', body: { ...form, startsAt: new Date(form.startsAt).toISOString() } });
            setForm({ title: '', location: '', startsAt: '' });
          });
        }}
      >
        <h2 className="font-bold">Plan a new event</h2>
        <label className="block text-sm font-medium">Title<input className="input mt-1" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="block text-sm font-medium">Location<input className="input mt-1" required maxLength={160} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
        <label className="block text-sm font-medium">Starts at<input type="datetime-local" className="input mt-1" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
        <button className="btn-primary w-full">Create event</button>
      </form>
    </div>
  );
}

async function downloadCsv(event) {
  const res = await fetch(`/api/events/${event.id}/export.csv`, { headers: { authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) throw new Error('Export failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `fixwerk-event-${event.id}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
