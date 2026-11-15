# Fixwerk

**A real-time platform for running community repair cafés.**

At a repair café, volunteers fix broken things (toasters, bikes, jeans, laptops) for free, so those things stay out of the bin. These events are usually run with paper lists and shouting across the room. Fixwerk replaces that with a live queue, skill-based volunteer matching, and impact tracking.

## Features

| | |
|---|---|
| **Visitor check-in** | Visitors scan the QR code on the board, register their item, and get a ticket code (`FX-7KQ2`) with its own QR code, their place in the queue, and an estimated wait. |
| **Smart triage** | While the visitor types, Fixwerk guesses the category and forecasts the chance of a successful repair from similar past repairs, showing what fixed them before. |
| **Live queue board** | A full-screen board for a TV at the venue. It updates instantly over WebSockets. |
| **Ticket tracking** | Visitors follow their item through *queue → bench → done* in real time and read the fixer's note at the end. |
| **Fixer matching** | Each waiting item gets the 3 best-suited volunteers, ranked by skill, track record in that category, and current workload. Each suggestion explains why. |
| **Workbench** | Fixers claim items and record the outcome (fixed, partly fixed, advice given, or not fixable), notes, and weight. Organizers can assign items directly. |
| **Live fixer alerts** | When an item matching a fixer's skills is checked in, that fixer gets an instant pop-up on their workbench. |
| **Visitor feedback** | Visitors rate the repair (1–5 ★) from the tracking page, once per ticket. Ratings appear on the impact page and per fixer. |
| **Repair wiki** | Every finished repair becomes a searchable note, so the next fixer doesn't start from zero. |
| **Impact dashboard** | Shows waste and CO₂e avoided, success rate per category and per event, typical repair time, visitor rating, and a volunteer leaderboard. |
| **Volunteer sign-ups** | Fixers sign up for events. Matching and wait estimates count only the volunteers who are actually there. |
| **Spare-parts inventory** | Fixers record the parts they used. Stock goes down in the same database transaction as the repair, so a shortage rolls the whole step back. Low stock is flagged and organizers can restock. |
| **Ticket history** | Every step (checked in, claimed, assigned, released, finished, rated) is logged and shown to the visitor as a timeline. |
| **Team management** | Organizers add fixers or organizers and can deactivate accounts. Deactivation blocks sign-in and invalidates existing sessions immediately. |
| **Visitor emails** | Visitors who leave an email get "It's your turn" and "Your repair is done" messages. They are queued in an outbox table; in the demo the organizer **Mailbox** shows them instead of sending them. |
| **CSV export** | Organizers download an event's data as a CSV file that opens correctly in Excel and is protected against formula injection. |

## Tech stack

- **Backend:** Node.js 24, Express 5, Socket.IO, SQLite (built-in `node:sqlite`, so no database server is needed)
- **Frontend:** React 19, React Router, Tailwind CSS 4, Vite
- **Auth:** scrypt password hashing and HMAC-signed tokens with role-based access (organizer / fixer)
- **Tests:** `node:test`, covering unit tests for domain logic and HTTP integration tests for the full repair flow

## Run it

```bash
npm install
npm run dev        # API on :4300, UI on http://localhost:5180
```

The database is created and filled with demo data on the first start: 6 past events, one live event with a running queue, and one upcoming event.

**Demo logins** (password `Fixwerk2026!`, or use the one-click buttons on the sign-in page):

| Account | Role |
|---|---|
| lena@fixwerk.demo | Organizer |
| mehmet@fixwerk.demo | Fixer: electronics, appliances, computers |
| ingrid@fixwerk.demo | Fixer: textiles, toys |
| tomasz@fixwerk.demo | Fixer: bikes, furniture |

Or run the production build in Docker:

```bash
docker compose up --build   # http://localhost:4300, data kept in a Docker volume
```

GitHub Actions runs the tests, the client build and the Docker build on every push.

Other commands:

```bash
npm test           # server test suite
npm run build      # production build of the UI
npm start          # serve API + built UI on :4300 (set TOKEN_SECRET)
npm run reset-db   # delete the local database; it is re-seeded on the next start
```

## Suggested demo flow (5 minutes)

1. Open **Events** and click **Open live board** in a second window.
2. Click **Check in an item** and register something. The board updates instantly.
3. Sign in as **Tomasz**. In the **Workbench**, look at the match scores (hover a suggestion for the reasons), then claim the item.
4. Finish the repair with a note. The board, the visitor's status page, and the impact numbers update live.
5. Search the note in the **Repair wiki**.
6. Bonus: type "coffee machine leaks" on the check-in form to show the smart triage, and rate the finished repair on the visitor's status page.

## Design notes

- **Matching score (0–100):** skill match 45, smoothed success rate in the category 30 (Laplace: `(wins+1)/(n+2)`, so new fixers start at 50 %), experience 15, free capacity 10. The code is in [`server/src/domain/matching.js`](server/src/domain/matching.js).
- **Wait estimate:** the median historical repair time × ⌈position ÷ number of fixers⌉.
- **Race-safe claiming:** a claim is a conditional `UPDATE … WHERE status = 'waiting'`. If two fixers click at the same moment, one gets a clear 409 error instead of both getting the item.
- **Triage:** word overlap (Jaccard similarity) against past repairs, combined with keyword hints. The forecast is a Laplace-smoothed success rate over the most similar repairs in the guessed category. Everything runs locally, with no external AI service. The code is in [`server/src/domain/triage.js`](server/src/domain/triage.js).
- **Hardening:** per-IP rate limits on login, check-in, triage and feedback (HTTP 429), security headers, and additive database migrations so older databases keep working.
- **Transactions:** claiming and finishing a repair run in SQLite transactions. Stock is decremented with `UPDATE … WHERE stock >= qty`, so concurrent repairs can never drive stock negative.
- **Outbox pattern:** emails are written to an `outbox` table inside the same request, so a mail worker can deliver them later without losing any if the mail server is down.
- **Privacy:** public endpoints only show the visitor's first name, never their email.
- **Real-time model:** the server emits a lightweight `board:changed` signal to the event's Socket.IO room, and clients refetch. This keeps a single source of truth: REST.
- **Impact factors** (average weight and CO₂e per kg, by category) are rounded, illustrative estimates in [`server/src/domain/categories.js`](server/src/domain/categories.js), not audited lifecycle (LCA) data.

## Project structure

```
server/src/
  app.js            REST API (routes, validation, auth guards)
  index.js          HTTP + Socket.IO bootstrap
  db.js             SQLite schema
  seed.js           deterministic demo data
  domain/           matching, wait estimate, impact (pure, unit-tested)
client/src/
  pages/            Home, CheckIn, Status, Board, Workbench, Knowledge, Impact, Organizer,
                    Volunteers, FixerProfile, EventReport, Profile, About, NotFound
  hooks.js          useApi, useLiveEvent (Socket.IO), auth context
```
