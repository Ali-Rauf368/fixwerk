import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.js';
import OrgTabs from '../components/OrgTabs.jsx';
import { CATEGORIES, ErrorNote, Pill, Spinner } from '../components/ui.jsx';
import { useApi, useAuth } from '../hooks.js';
import { Avatar } from './Volunteers.jsx';

const EMPTY = { name: '', email: '', password: '', role: 'fixer', skills: [] };

export default function Team() {
  const { user } = useAuth();
  const team = useApi('/team');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const run = async (fn) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      team.reload();
    } catch (err) {
      setError(err);
    }
  };
  const toggleSkill = (k) => setForm((f) => ({ ...f, skills: f.skills.includes(k) ? f.skills.filter((s) => s !== k) : [...f.skills, k] }));

  return (
    <>
      <OrgTabs />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">Team</h1>
          <ErrorNote error={error} />
          {notice && <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{notice}</div>}
          {team.loading ? <Spinner /> : (
            <div className="card divide-y divide-stone-100 p-0">
              {team.data.map((m) => (
                <div key={m.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${m.active ? '' : 'opacity-50'}`}>
                  <Avatar id={m.id} name={m.name} size="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {m.role === 'fixer' && m.active ? <Link to={`/volunteers/${m.id}`} className="font-semibold hover:underline">{m.name}</Link> : <span className="font-semibold">{m.name}</span>}
                      <Pill cls={m.role === 'organizer' ? 'bg-violet-100 text-violet-800' : 'bg-stone-100 text-stone-600'}>{m.role}</Pill>
                      {!m.active && <Pill cls="bg-red-100 text-red-700">inactive</Pill>}
                    </div>
                    <div className="truncate text-xs text-stone-500">{m.email} · {m.repairs} repairs {m.skills.length > 0 && `· ${m.skills.map((s) => CATEGORIES[s]?.icon).join(' ')}`}</div>
                  </div>
                  {m.id !== user.id && (
                    <button type="button" className="btn-ghost text-xs" onClick={() => run(() => api(`/team/${m.id}`, { method: 'PATCH', body: { active: !m.active } }))}>
                      {m.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <form
          className="card h-fit space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/team', { method: 'POST', body: form });
              setNotice(`${form.name} can now sign in with ${form.email}.`);
              setForm(EMPTY);
            });
          }}
        >
          <h2 className="font-bold">Add a team member</h2>
          <label className="block text-sm font-medium">Name<input className="input mt-1" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block text-sm font-medium">Email<input type="email" className="input mt-1" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="block text-sm font-medium">First password<input type="text" className="input mt-1" required minLength={8} placeholder="at least 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label className="block text-sm font-medium">Role
            <select className="input mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="fixer">Fixer</option>
              <option value="organizer">Organizer</option>
            </select>
          </label>
          {form.role === 'fixer' && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Skills</legend>
              <div className="flex flex-wrap gap-1">
                {Object.entries(CATEGORIES).map(([k, c]) => (
                  <button key={k} type="button" aria-pressed={form.skills.includes(k)} onClick={() => toggleSkill(k)} className={`rounded-full px-2.5 py-1 text-xs ${form.skills.includes(k) ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600'}`}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button className="btn-primary w-full">Add to team</button>
        </form>
      </div>
    </>
  );
}
