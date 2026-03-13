import { useState, lazy, Suspense } from 'react';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { WalletProvider } from './context/WalletContext';
import { AuthProvider } from './context/AuthContext';
import { WsProvider } from './context/WsContext';
import type { TournamentType } from './types';

// Layout
import { SpaceBackground } from './components/SpaceBackground';
import { TopBar } from './components/TopBar';

// Eager — first page everyone sees
import { HomePage } from './pages/HomePage';

// Lazy — only downloaded when navigated to
const TournamentDetailPage = lazy(() => import('./pages/TournamentDetailPage').then(m => ({ default: m.TournamentDetailPage })));
const GamePage             = lazy(() => import('./pages/GamePage').then(m => ({ default: m.GamePage })));
const ResultPage           = lazy(() => import('./pages/ResultPage').then(m => ({ default: m.ResultPage })));
const TournamentEntryPage  = lazy(() => import('./pages/TournamentEntryPage').then(m => ({ default: m.TournamentEntryPage })));
const AdminPage            = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const GameGuidePage        = lazy(() => import('./pages/GameGuidePage').then(m => ({ default: m.GameGuidePage })));

// ── Page types ────────────────────────────────────────────────────────────────

export type PageName =
  | 'home'
  | 'lobby'               // alias for 'home' (backward compat)
  | 'tournament-detail'
  | 'game'
  | 'result'
  | 'tournament-entry'
  | 'admin'
  | 'guide';

export interface PageContext {
  tournamentType?: TournamentType;
  resultSessionId?: string;
}

// Pages where the TopBar should NOT be shown (fullscreen gameplay)
const HIDE_TOPBAR: PageName[] = ['game'];

// ── App shell ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<PageName>('home');
  const [pageCtx, setPageCtx] = useState<PageContext>({});

  const navigate = (to: PageName, ctx: PageContext = {}) => {
    // Normalize 'lobby' → 'home'
    const resolved = to === 'lobby' ? 'home' : to;
    setPageCtx(ctx);
    setPage(resolved);
  };

  const showTopBar = !HIDE_TOPBAR.includes(page);

  return (
    <WalletConnectProvider theme="dark">
      <WalletProvider>
        <AuthProvider>
          <WsProvider>
            {/* Space background renders behind everything */}
            <SpaceBackground />

            {/* Sticky top bar (hidden during gameplay) */}
            {showTopBar && <TopBar navigate={navigate} currentPage={page} />}

            {/* Pages */}
            {(page === 'home' || page === 'lobby') && <HomePage navigate={navigate} />}
            <Suspense fallback={null}>
              {page === 'tournament-detail' && <TournamentDetailPage navigate={navigate} ctx={pageCtx} />}
              {page === 'game'              && <GamePage navigate={navigate} ctx={pageCtx} />}
              {page === 'result'            && <ResultPage navigate={navigate} ctx={pageCtx} />}
              {page === 'tournament-entry'  && <TournamentEntryPage navigate={navigate} ctx={pageCtx} />}
              {page === 'admin'             && <AdminPage navigate={navigate} />}
              {page === 'guide'             && <GameGuidePage navigate={navigate} />}
            </Suspense>
          </WsProvider>
        </AuthProvider>
      </WalletProvider>
    </WalletConnectProvider>
  );
}

// ── Shared navigation prop type ───────────────────────────────────────────────

export interface NavigateFn {
  (to: PageName, ctx?: PageContext): void;
}
