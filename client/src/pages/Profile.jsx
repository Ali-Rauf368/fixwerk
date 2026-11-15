import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.js';
import { CATEGORIES, ErrorNote } from '../components/ui.jsx';
import { useAuth } from '../hooks.js';
import { Avatar } from './Volunteers.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [skills, setSkills] = useState(user.skills ?? []);
  const [state, setState] = useState({ saving: false, saved: false, error: null });
  const dirty = [...skills].sort().join() !== [...(user.skills ?? [])].sort().join();
  const toggle = (k) => {
    setState((s) => ({ ...s, saved: false }));
    setSkills((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-4">
        <Avatar id={user.id} name={user.name} size="h-16 w-16 text-xl" />
        <div>
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-sm capitalize text-stone-500">{user.role}</p>
        </div>
        {user.role === 'fixer' && <Link to={`/volunteers/${user.id}`} className="btn-ghost ml-auto">View public profile</Link>}
      </header>

      {user.role === 'fixer' ? (
        <form
          className="card space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setState({ saving: true, saved: false, error: null });
            try {
              const res = await api('/me/skills', { method: 'PUT', body: { skills } });
              setUser({ ...user, skills: res.skills });
              setState({ saving: false, saved: true, error: null });
            } catch (error) {
              setState({ saving: false, saved: false, error });
            }
          }}
        >
          <div>
            <h2 className="font-bold">My skills</h2>
            <p className="text-sm text-stone-500">Matching uses these: items in your categories are suggested to you first, and you get a pop-up when one is checked in.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(CATEGORIES).map(([k, c]) => {
              const on = skills.includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)} className={`rounded-xl border p-3 text-center text-sm transition ${on ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-stone-200 hover:border-stone-400'}`}>
                  <div className="text-2xl" aria-hidden>{c.icon}</div>{c.label}
                </button>
              );
            })}
          </div>
          <ErrorNote error={state.error} />
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!dirty || state.saving}>{state.saving ? 'Saving…' : 'Save skills'}</button>
            {state.saved && <span className="text-sm text-brand-700">✓ Saved. Matching uses your new skills right away.</span>}
          </div>
        </form>
      ) : (
        <div className="card text-sm text-stone-600">
          As an organizer you can plan and run events under <Link to="/organize" className="font-semibold text-brand-700">Organize</Link>, assign items on the <Link to="/workbench" className="font-semibold text-brand-700">Workbench</Link>, and export event data.
        </div>
      )}
    </div>
  );
}
