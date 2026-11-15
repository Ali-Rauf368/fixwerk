import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ErrorNote } from '../components/ui.jsx';
import { useAuth } from '../hooks.js';

const DEMO = [
  ['lena@fixwerk.demo', 'Lena – organizer'],
  ['mehmet@fixwerk.demo', 'Mehmet – electronics fixer'],
  ['ingrid@fixwerk.demo', 'Ingrid – textiles fixer'],
  ['tomasz@fixwerk.demo', 'Tomasz – bikes fixer'],
];
const DEMO_PASSWORD = 'Fixwerk2026!';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds = { email, password }) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(creds.email, creds.password);
      navigate(state?.from ?? (user.role === 'organizer' ? '/organize' : '/workbench'), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
      <form className="card space-y-4" onSubmit={submit}>
        <h1 className="text-2xl font-bold">Volunteer sign-in</h1>
        <label className="block text-sm font-medium">Email<input type="email" className="input mt-1" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input type="password" className="input mt-1" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <ErrorNote error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="card bg-brand-50">
        <h2 className="font-bold">Demo accounts</h2>
        <p className="mb-3 text-sm text-stone-600">Password for all: <code className="font-mono">{DEMO_PASSWORD}</code></p>
        <div className="space-y-2">
          {DEMO.map(([mail, label]) => (
            <button key={mail} type="button" disabled={busy} className="btn-ghost w-full justify-start" onClick={() => submit(null, { email: mail, password: DEMO_PASSWORD })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
