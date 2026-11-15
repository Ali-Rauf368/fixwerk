import { useState } from 'react';
import { api } from '../api.js';
import OrgTabs from '../components/OrgTabs.jsx';
import { CATEGORIES, ErrorNote, Pill, Spinner, StatTile, fmtNum } from '../components/ui.jsx';
import { useApi, useAuth } from '../hooks.js';

const EMPTY = { name: '', category: '', stock: '', minStock: '', unitCost: '' };
const euro = (n) => `€${fmtNum(n, 2)}`;

export default function Inventory() {
  const { user } = useAuth();
  const isOrganizer = user.role === 'organizer';
  const { data, error, reload } = useApi('/parts');
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState(null);
  const [onlyLow, setOnlyLow] = useState(false);

  const run = async (fn) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    }
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const low = data.filter((p) => p.low);
  const shown = onlyLow ? low : data;
  const value = data.reduce((s, p) => s + p.stock * p.unit_cost, 0);
  const usedValue = data.reduce((s, p) => s + p.used * p.unit_cost, 0);

  return (
    <>
      {isOrganizer && <OrgTabs />}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Spare parts</h1>
          <p className="text-sm text-stone-500">Fixers record parts when finishing a repair, and stock updates automatically.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Parts in stock" value={fmtNum(data.reduce((s, p) => s + p.stock, 0))} hint={`${data.length} different parts`} />
          <StatTile label="Running low" value={low.length} hint={low.length ? low.slice(0, 2).map((p) => p.name).join(', ') + (low.length > 2 ? '…' : '') : 'all good'} />
          <StatTile label="Stock value" value={euro(value)} hint={`${euro(usedValue)} of parts used in repairs so far`} />
        </div>
        <ErrorNote error={actionError} />

        <div className={`grid gap-6 ${isOrganizer ? 'lg:grid-cols-[1fr_20rem]' : ''}`}>
          <section className="card overflow-x-auto">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Stock</h2>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only low stock</label>
            </div>
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-stone-500"><tr><th className="pb-2">Part</th><th className="pb-2">Category</th><th className="pb-2 w-40">Stock</th><th className="pb-2 text-right">Used</th><th className="pb-2 text-right">Unit</th>{isOrganizer && <th />}</tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100">
                    <td className="py-2 font-medium">{p.name} {p.low && <Pill cls="ml-1 bg-red-100 text-red-700">low</Pill>}</td>
                    <td className="py-2 text-stone-600">{CATEGORIES[p.category]?.icon} {CATEGORIES[p.category]?.label}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-right tabular-nums">{p.stock}</span>
                        <span className="h-2 flex-1 rounded-full bg-stone-100" title={`minimum ${p.min_stock}`}>
                          <span className={`block h-full rounded-full ${p.low ? 'bg-red-400' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (p.stock / Math.max(1, p.min_stock * 3)) * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{p.used}</td>
                    <td className="py-2 text-right tabular-nums">{euro(p.unit_cost)}</td>
                    {isOrganizer && (
                      <td className="py-2 pl-2 text-right">
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => run(() => api(`/parts/${p.id}/restock`, { method: 'POST', body: { qty: Math.max(p.min_stock * 2 - p.stock, 5) } }))}>
                          Restock
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {isOrganizer && (
            <form
              className="card h-fit space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api('/parts', { method: 'POST', body: { ...form, stock: Number(form.stock || 0), minStock: Number(form.minStock || 0), unitCost: Number(form.unitCost || 0) } });
                  setForm(EMPTY);
                });
              }}
            >
              <h2 className="font-bold">Add a part</h2>
              <label className="block text-sm font-medium">Name<input className="input mt-1" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="block text-sm font-medium">Category
                <select className="input mt-1" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="" disabled>Choose…</option>
                  {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-sm font-medium">Stock<input type="number" min="0" className="input mt-1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
                <label className="text-sm font-medium">Min.<input type="number" min="0" className="input mt-1" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></label>
                <label className="text-sm font-medium">€ / unit<input type="number" min="0" step="0.01" className="input mt-1" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></label>
              </div>
              <button className="btn-primary w-full">Add part</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
