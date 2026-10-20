import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Nav } from './Nav';
import { Dashboard } from '@/features/progress/Dashboard';
import { ProgressPage } from '@/features/progress/ProgressPage';
import { TalkPage } from '@/features/conversation/TalkPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ShadowPage } from '@/features/shadowing/ShadowPage';
import { ReviewPage } from '@/features/review/ReviewPage';
import { InstantPage } from '@/features/instant/InstantPage';
import { startSyncLoop } from '@/lib/sync';

export default function App() {
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/talk');

  useEffect(() => startSyncLoop(), []);

  return (
    <div className="min-h-full flex flex-col">
      {!immersive && <Nav />}
      <main className={immersive ? 'flex-1 flex flex-col' : 'flex-1 mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:pb-10'}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/talk" element={<TalkPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/shadow" element={<ShadowPage />} />
          <Route path="/instant" element={<InstantPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
