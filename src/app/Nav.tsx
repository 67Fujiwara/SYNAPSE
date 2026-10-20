import { NavLink } from 'react-router-dom';
import { Home, Mic, Repeat, Zap, ClipboardCheck, TrendingUp, Settings } from 'lucide-react';
import { useT } from '@/i18n';
import { cx } from '@/lib/util';

const ITEMS = [
  { to: '/', key: 'nav.home', Icon: Home },
  { to: '/talk', key: 'nav.talk', Icon: Mic },
  { to: '/shadow', key: 'nav.shadow', Icon: Repeat },
  { to: '/instant', key: 'nav.instant', Icon: Zap },
  { to: '/review', key: 'nav.review', Icon: ClipboardCheck },
  { to: '/progress', key: 'nav.progress', Icon: TrendingUp },
  { to: '/settings', key: 'nav.settings', Icon: Settings },
] as const;

export function Nav() {
  const { t } = useT();
  return (
    <>
      {/* Top bar (desktop) */}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <NavLink to="/" className="flex items-center gap-2">
            <Logo />
            <span className="font-display text-lg font-semibold tracking-tight">SYNAPSE</span>
            <span className="hidden text-xs text-ink-3 sm:inline">· {t('app.tagline')}</span>
          </NavLink>
          <nav className="hidden items-center gap-1 sm:flex">
            {ITEMS.map(({ to, key, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition',
                    isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink hover:bg-surface-2/60',
                  )
                }
              >
                <Icon size={16} />
                {t(key)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {/* Bottom tabs (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t border-line bg-bg/90 backdrop-blur sm:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {ITEMS.map(({ to, key, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[10px]', isActive ? 'text-accent' : 'text-ink-3')
            }
          >
            <Icon size={18} />
            {t(key)}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="rgb(var(--c-surface-2))" />
      <path d="M14 40 L26 40 L30 24 L36 44 L40 32 L50 32" fill="none" stroke="rgb(var(--c-accent))" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="40" r="4" fill="rgb(var(--c-accent))" />
      <circle cx="50" cy="32" r="4" fill="rgb(var(--c-lime))" />
    </svg>
  );
}
