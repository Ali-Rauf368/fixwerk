import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api.js';
import { Category, ErrorNote, OUTCOMES, Spinner, Stars, fmtWait } from '../components/ui.jsx';
import { useApi, useLiveEvent } from '../hooks.js';

const STEPS = [
  ['waiting', 'In the queue'],
  ['in_repair', 'On the bench'],
  ['done', 'Done'],
];

export default function Status() {
  const { code } = useParams();
  const { data: t, error, loading, reload } = useApi(`/tickets/by-code/${encodeURIComponent(code)}`);
  const live = useLiveEvent(t?.eventId, reload);

  if (loading) return <Spinner />;
  if (error) return <div className="mx-auto max-w-md space-y-4"><ErrorNote error={error} /><Link to="/" className="btn-ghost">Back</Link></div>;

  const step = STEPS.findIndex(([s]) => s === t.status);
  return (
    <div className="card mx-auto max-w-lg">
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg font-bold">{t.code}</span>
        <span className={`text-xs ${live ? 'text-brand-600' : 'text-stone-400'}`}>{live ? '● live updates' : 'offline'}</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold">{t.item}</h1>
      <Category value={t.category} />
      <p className="text-sm text-stone-500">{t.eventTitle}</p>

      <ol className="my-8 grid grid-cols-3 gap-2">
        {STEPS.map(([key, label], i) => (
          <li key={key} className="text-center">
            <div className={`mx-auto mb-2 h-2 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-stone-200'}`} />
            <span className={`text-xs font-semibold ${i === step ? 'text-brand-700' : 'text-stone-400'}`}>{label}</span>
          </li>
        ))}
      </ol>

      {t.status === 'waiting' && (
        <p className="text-lg">You are <b>#{t.position}</b> in the queue. Estimated wait: <b>{fmtWait(t.estimatedWaitMin)}</b>.</p>
      )}
      {t.status === 'in_repair' && <p className="text-lg"><b>{t.fixer}</b> is working on your item right now. Please come to the bench.</p>}
      {t.status === 'done' && (
        <div className="space-y-2">
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${OUTCOMES[t.outcome].cls}`}>{OUTCOMES[t.outcome].label}</span>
          {t.notes && <p className="rounded-lg bg-stone-50 p-3 text-sm"><b>{t.fixer}’s note:</b> {t.notes}</p>}
          {(t.outcome === 'fixed' || t.outcome === 'partial') && <p className="text-sm text-brand-700">Thanks for giving it a second life 🌱</p>}
          <Feedback code={t.code} rated={t.rating} onDone={reload} />
        </div>
      )}
    </div>
  );
}

function Feedback({ code, rated, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  if (rated) {
    return <p className="mt-4 flex items-center gap-2 border-t border-stone-100 pt-4 text-sm text-stone-600">Your rating: <Stars value={rated} size="text-lg" /></p>;
  }
  return (
    <form
      className="mt-4 space-y-2 border-t border-stone-100 pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/tickets/by-code/${code}/feedback`, { method: 'POST', body: { rating, comment } });
          onDone();
        } catch (err) {
          setError(err);
        }
      }}
    >
      <p className="text-sm font-semibold">How was your visit?</p>
      <Stars value={rating} onChange={setRating} />
      <textarea className="input" rows={2} maxLength={500} placeholder="Anything you want to tell the volunteers? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <ErrorNote error={error} />
      <button className="btn-primary" disabled={!rating}>Send feedback</button>
    </form>
  );
}
