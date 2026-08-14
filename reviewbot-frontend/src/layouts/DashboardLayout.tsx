import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGeminiUsage } from '@/hooks/api/useAdhocReview';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? 'border-primary text-foreground inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors';

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? 'block rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary'
    : 'block rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/review', label: 'Review Code', end: false },
  { to: '/projects', label: 'Projects', end: false },
  { to: '/reviews', label: 'Reviews', end: false },
  { to: '/developers', label: 'Developers', end: false },
];

function UsageBadge() {
  const { data } = useGeminiUsage();
  if (!data) return null;
  const pct = Math.min(100, Math.round((data.used / data.limit) * 100));
  const color = pct >= 100 ? '#FF6B6B' : pct >= 70 ? '#FFB454' : '#5EEAD4';
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium md:inline-flex"
      style={{ borderColor: `${color}40`, color }}
      title={`${data.used}/${data.limit} Gemini requests used today`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {data.used}/{data.limit} today
    </span>
  );
}

export const DashboardLayout = () => {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-display font-bold text-sm">
                  {'</>'}
                </span>
                <h1 className="text-xl font-display font-bold text-foreground">Code Buddy</h1>
              </div>
              <div className="hidden sm:ml-8 sm:flex sm:space-x-6">
                {NAV_ITEMS.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <UsageBadge />
              <div className="hidden sm:flex sm:items-center">
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-muted-foreground">{user?.username}</span>
                  <button
                    onClick={logout}
                    className="inline-flex items-center px-3 py-2 border border-border text-sm leading-4 font-medium rounded-md text-foreground bg-secondary hover:bg-secondary-hover transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary"
                  >
                    Log out
                  </button>
                </div>
              </div>
              {/* Mobile menu toggle - nav links have nowhere else to go below sm */}
              <button
                onClick={() => setMobileOpen((o) => !o)}
                className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-secondary/40 hover:text-foreground sm:hidden"
                aria-label="Toggle menu"
              >
                {mobileOpen ? (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-border px-4 py-3 sm:hidden">
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={mobileNavLinkClass}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">{user?.username}</span>
              <button
                onClick={logout}
                className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary-hover"
              >
                Log out
              </button>
            </div>
          </div>
        )}
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
};
