import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/** Fetch JSON and expose { data, error, loading, reload }. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    api(path)
      .then((data) => n === seq.current && setState({ data, error: null, loading: false }))
      .catch((error) => n === seq.current && setState((s) => ({ ...s, error, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

let socket;
const getSocket = () => (socket ??= io({ transports: ['websocket', 'polling'] }));

/** Call onChange whenever anything on the event's board changes. */
export function useLiveEvent(eventId, onChange) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!eventId) return undefined;
    const s = getSocket();
    const watch = () => {
      s.emit('watch', eventId);
      setConnected(true);
      cb.current();
    };
    const lost = () => setConnected(false);
    const changed = (msg) => Number(msg.eventId) === Number(eventId) && cb.current();
    if (s.connected) watch();
    s.on('connect', watch);
    s.on('disconnect', lost);
    s.on('board:changed', changed);
    return () => {
      s.emit('unwatch', eventId);
      s.off('connect', watch);
      s.off('disconnect', lost);
      s.off('board:changed', changed);
    };
  }, [eventId]);
  return connected;
}

/** Re-render every `ms` so relative times stay fresh. */
export function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Subscribe to a named Socket.IO event for one event room (room joined via useLiveEvent). */
export function useSocketEvent(eventId, name, handler) {
  const cb = useRef(handler);
  cb.current = handler;
  useEffect(() => {
    if (!eventId) return undefined;
    const s = getSocket();
    const fn = (msg) => Number(msg.eventId) === Number(eventId) && cb.current(msg);
    s.on(name, fn);
    return () => s.off(name, fn);
  }, [eventId, name]);
}
