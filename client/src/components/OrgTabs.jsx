import { NavLink } from 'react-router';

const TABS = [
  ['/organize', 'Events'],
  ['/organize/team', 'Team'],
  ['/inventory', 'Spare parts'],
  ['/organize/mailbox', 'Mailbox'],
];

/** Sub-navigation shared by the organizer pages. */
export default function OrgTabs() {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-stone-200" aria-label="Organizer sections">
      {TABS.map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => `-mb-px border-b-2 px-4 py-2 text-sm font-semibold whitespace-nowrap ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-stone-500 hover:text-ink'}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
