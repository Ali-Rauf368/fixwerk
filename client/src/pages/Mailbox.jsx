import { useState } from 'react';
import OrgTabs from '../components/OrgTabs.jsx';
import { ErrorNote, Spinner } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Development mailbox: shows the emails Fixwerk would send to visitors. */
export default function Mailbox() {
  const { data, error, reload } = useApi('/outbox');
  const [open, setOpen] = useState(null);
  const current = data?.find((m) => m.id === open) ?? data?.[0];

  return (
    <>
      <OrgTabs />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Mailbox</h1>
          <p className="text-sm text-stone-500">Emails sent to visitors who left an address. In this demo they are stored here instead of being delivered.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={reload}>Refresh</button>
      </div>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : !data.length ? (
        <div className="card text-center text-stone-500">No emails yet. Claim or finish an item from a visitor with an email address to see one here.</div>
      ) : (
        <div className="card grid gap-0 overflow-hidden p-0 md:grid-cols-[20rem_1fr]">
          <ul className="max-h-[32rem] divide-y divide-stone-100 overflow-y-auto border-b border-stone-200 md:border-r md:border-b-0">
            {data.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m.id)} className={`w-full px-4 py-3 text-left text-sm ${current?.id === m.id ? 'bg-brand-50' : 'hover:bg-stone-50'}`}>
                  <div className="truncate font-semibold">{m.subject}</div>
                  <div className="flex justify-between text-xs text-stone-500"><span className="truncate">{m.to_email}</span><span>{fmtTime(m.created_at)}</span></div>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <article className="p-6">
              <h2 className="text-lg font-bold">{current.subject}</h2>
              <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-y-1 text-sm text-stone-500">
                <dt>To</dt><dd className="text-ink">{current.to_email}</dd>
                <dt>Sent</dt><dd>{fmtTime(current.created_at)}</dd>
                {current.code && <><dt>Ticket</dt><dd className="font-mono">{current.code}</dd></>}
              </dl>
              <p className="mt-6 text-sm leading-relaxed whitespace-pre-line">{current.body}</p>
            </article>
          )}
        </div>
      )}
    </>
  );
}
