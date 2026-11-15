import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { api, tokenStore } from './api.js';
import { AuthContext, useAuth } from './hooks.js';
import About from './pages/About.jsx';
import Board from './pages/Board.jsx';
import EventReport from './pages/EventReport.jsx';
import FixerProfile from './pages/FixerProfile.jsx';
import NotFound from './pages/NotFound.jsx';
import Profile from './pages/Profile.jsx';
import Volunteers from './pages/Volunteers.jsx';
import CheckIn from './pages/CheckIn.jsx';
import Home from './pages/Home.jsx';
import Impact from './pages/Impact.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Login from './pages/Login.jsx';
import Organizer from './pages/Organizer.jsx';
import Status from './pages/Status.jsx';
import Workbench from './pages/Workbench.jsx';

function RequireAuth({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Nav() {
  const { user, logout } = useAuth();
  const link = ({ isActive }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:text-ink'}`;
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <Link to="/" className="mr-4 flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">🔧</span> Fixwerk
        </Link>
        <nav className="flex flex-wrap gap-1">
          <NavLink to="/" end className={link}>Events</NavLink>
          <NavLink to="/impact" className={link}>Impact</NavLink>
          <NavLink to="/volunteers" className={link}>Volunteers</NavLink>
          <NavLink to="/about" className={link}>How it works</NavLink>
          {user && <NavLink to="/workbench" className={link}>Workbench</NavLink>}
          {user && <NavLink to="/knowledge" className={link}>Repair wiki</NavLink>}
          {user?.role === 'organizer' && <NavLink to="/organize" className={link}>Organize</NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link to="/profile" className="hidden text-stone-500 hover:text-ink sm:inline">
                {user.name} · <span className="capitalize">{user.role}</span>
              </Link>
              <button type="button" className="btn-ghost py-1.5" onClick={logout}>Sign out</button>
            </>
          ) : (
            <Link to="/login" className="btn-ghost py-1.5">Volunteer sign-in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tokenStore.get()) return setReady(true);
    api('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, []);

  const auth = useMemo(
    () => ({
      user,
      ready,
      setUser,
      login: async (email, password) => {
        const res = await api('/auth/login', { method: 'POST', body: { email, password } });
        tokenStore.set(res.token);
        setUser(res.user);
        return res.user;
      },
      logout: () => {
        tokenStore.set(null);
        setUser(null);
      },
    }),
    [user, ready],
  );

  const { pathname } = useLocation();
  const fullscreen = pathname.startsWith('/board/');

  return (
    <AuthContext.Provider value={auth}>
      {!fullscreen && <Nav />}
      <main className={fullscreen ? '' : 'mx-auto max-w-6xl px-4 py-8'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/checkin/:eventId" element={<CheckIn />} />
          <Route path="/status/:code" element={<Status />} />
          <Route path="/board/:eventId" element={<Board />} />
          <Route path="/impact" element={<Impact />} />
          <Route path="/events/:id" element={<EventReport />} />
          <Route path="/volunteers" element={<Volunteers />} />
          <Route path="/volunteers/:id" element={<FixerProfile />} />
          <Route path="/about" element={<About />} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/login" element={<Login />} />
          <Route path="/workbench" element={<RequireAuth><Workbench /></RequireAuth>} />
          <Route path="/knowledge" element={<RequireAuth><Knowledge /></RequireAuth>} />
          <Route path="/organize" element={<RequireAuth roles={['organizer']}><Organizer /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </AuthContext.Provider>
  );
}
