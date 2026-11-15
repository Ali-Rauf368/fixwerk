import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export const CATEGORIES = {
  electronics: { label: 'Electronics', icon: '📻' },
  computers: { label: 'Computers & phones', icon: '💻' },
  appliances: { label: 'Kitchen appliances', icon: '☕' },
  textiles: { label: 'Textiles', icon: '🧵' },
  bikes: { label: 'Bikes', icon: '🚲' },
  furniture: { label: 'Furniture & lamps', icon: '🪑' },
  toys: { label: 'Toys', icon: '🧸' },
  jewelry: { label: 'Jewelry & watches', icon: '⌚' },
};

export const OUTCOMES = {
  fixed: { label: 'Fixed', cls: 'bg-brand-100 text-brand-700' },
  partial: { label: 'Partly fixed', cls: 'bg-lime-100 text-lime-800' },
  advice: { label: 'Advice given', cls: 'bg-sky-100 text-sky-800' },
  not_fixable: { label: 'Not fixable', cls: 'bg-stone-200 text-stone-700' },
};

export const STATUS = {
  waiting: { label: 'Waiting', cls: 'bg-amber-100 text-amber-800' },
  in_repair: { label: 'On the bench', cls: 'bg-indigo-100 text-indigo-800' },
  done: { label: 'Done', cls: 'bg-brand-100 text-brand-700' },
};

export function Pill({ cls, children }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export const Category = ({ value }) => (
  <span className="inline-flex items-center gap-1 text-sm text-stone-600">
    <span aria-hidden>{CATEGORIES[value]?.icon}</span>
    {CATEGORIES[value]?.label ?? value}
  </span>
);

export function StatTile({ label, value, hint }) {
  return (
    <div className="card">
      <div className="text-sm font-medium text-stone-500">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message ?? String(error)}</div>;
}

export const Spinner = () => <div className="py-16 text-center text-stone-500">Loading…</div>;

export const fmtNum = (n, d = 0) => Number(n ?? 0).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtPct = (r) => `${Math.round((r ?? 0) * 100)} %`;
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const minutesSince = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
export const fmtWait = (m) => (m == null ? '—' : m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);


/** QR code rendered locally as SVG (no third-party service sees the URL). */
export function QR({ value, size = 160, dark = '#17201b', light = '#ffffff', className = '' }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: 'svg', margin: 1, color: { dark, light } }).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [value, dark, light]);
  return <div role="img" aria-label="QR code" className={`[&>svg]:h-full [&>svg]:w-full ${className}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Stars({ value, onChange, size = 'text-2xl' }) {
  return (
    <span className={`inline-flex ${size}`} role={onChange ? 'radiogroup' : 'img'} aria-label={`${value ?? 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)} className={n <= (value ?? 0) ? 'text-amber-400' : 'text-stone-300 hover:text-amber-200'}>★</button>
        ) : (
          <span key={n} className={n <= Math.round(value ?? 0) ? 'text-amber-400' : 'text-stone-300'}>★</span>
        ),
      )}
    </span>
  );
}
