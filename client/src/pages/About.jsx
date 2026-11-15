import { Link } from 'react-router';

const STEPS = [
  ['🎟️', 'Check in', 'Scan the QR code at the venue and describe what’s broken. Fixwerk suggests the category and tells you how often similar items were repaired.'],
  ['🤝', 'Get matched', 'Fixwerk suggests the best volunteer for each item, based on their skills, track record, and how busy they are.'],
  ['📱', 'Follow along', 'Watch your place in the queue on your phone or on the big screen. No app needed.'],
  ['🔧', 'Repair together', 'Sit with the fixer and learn how your item works. Most repairs take under 40 minutes.'],
  ['🌱', 'Count the impact', 'Every repair is logged. We count the waste and CO₂ saved, and each solution goes into the repair wiki.'],
];

const FAQ = [
  ['Does it cost anything?', 'No. Repair cafés are run by volunteers. Donations for spare parts are welcome but never required.'],
  ['What if my item can’t be fixed?', 'You’ll still leave knowing why, and often with advice on which spare part to order or where to go next.'],
  ['What should I bring?', 'The item, its charger or cable if it has one, and any spare parts you already have.'],
  ['What happens to my data?', 'Only your first name is shown publicly. Your email is optional and is never shown on the board.'],
  ['How is the CO₂ figure calculated?', 'From the average weight of each type of item and an estimate of the emissions it took to make it. These are rough, illustrative numbers, not an audited calculation.'],
  ['Can I volunteer?', 'Yes! Any repair skill is welcome, from sewing to soldering. Ask an organizer at the next event.'],
];

export default function About() {
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <header className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight">How a repair café works</h1>
        <p className="mx-auto mt-3 max-w-2xl text-stone-600">Neighbours bring broken things, volunteers help fix them, and fewer things end up in the bin. Fixwerk keeps the event running smoothly.</p>
      </header>

      <ol className="grid gap-4 md:grid-cols-5">
        {STEPS.map(([icon, title, text], i) => (
          <li key={title} className="card relative">
            <span className="absolute top-3 right-4 text-xs font-bold text-stone-300">{i + 1}</span>
            <div className="text-3xl" aria-hidden>{icon}</div>
            <h2 className="mt-2 font-bold">{title}</h2>
            <p className="mt-1 text-sm text-stone-600">{text}</p>
          </li>
        ))}
      </ol>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Questions</h2>
        <div className="space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="card group cursor-pointer py-4">
              <summary className="flex list-none items-center justify-between font-semibold">
                {q}<span className="text-stone-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-brand-700 p-8 text-center text-white">
        <h2 className="text-2xl font-bold">Ready to give something a second life?</h2>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link to="/" className="btn bg-white text-brand-700 hover:bg-brand-50">See upcoming events</Link>
          <Link to="/volunteers" className="btn border border-white/40 text-white hover:bg-white/10">Meet the volunteers</Link>
        </div>
      </section>
    </div>
  );
}
