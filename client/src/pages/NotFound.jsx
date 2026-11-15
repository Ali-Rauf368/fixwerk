import { Link } from 'react-router';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <div className="text-6xl" aria-hidden>🪛</div>
      <h1 className="mt-4 text-3xl font-bold">This page is beyond repair</h1>
      <p className="mt-2 text-stone-500">We couldn’t find what you were looking for.</p>
      <Link to="/" className="btn-primary mt-6">Back to events</Link>
    </div>
  );
}
