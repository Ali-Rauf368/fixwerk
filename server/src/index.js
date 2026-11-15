import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { DEMO_PASSWORD, seedIfEmpty } from './seed.js';

const PORT = Number(process.env.PORT ?? 4300);
const DB_FILE = process.env.DB_FILE ?? fileURLToPath(new URL('../data/fixwerk.db', import.meta.url));
let secret = process.env.TOKEN_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') throw new Error('TOKEN_SECRET must be set in production');
  secret = randomBytes(32).toString('hex');
}

const db = openDb(DB_FILE);
if (seedIfEmpty(db)) console.log(`Seeded demo data. Password for every demo account: ${DEMO_PASSWORD}`);

let io;
const app = createApp({
  db,
  secret,
  notify: (eventId, extra) => {
    const room = io?.to(`event:${eventId}`);
    room?.emit('board:changed', { eventId });
    if (extra) room?.emit(extra.type, { eventId, ...extra });
  },
  staticDir: fileURLToPath(new URL('../../client/dist', import.meta.url)),
});

const server = http.createServer(app);
io = new Server(server, { cors: { origin: false } });
io.on('connection', (socket) => {
  socket.on('watch', (eventId) => {
    const id = Number(eventId);
    if (Number.isInteger(id)) socket.join(`event:${id}`);
  });
  socket.on('unwatch', (eventId) => socket.leave(`event:${Number(eventId)}`));
});

server.listen(PORT, () => console.log(`Fixwerk API on http://localhost:${PORT}`));
