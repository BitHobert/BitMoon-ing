import { useState } from 'react';
import { WalletProvider } from './context/WalletContext';
import { AuthProvider } from './context/AuthContext';
import { WsProvider } from './context/WsContext';
import type { TournamentType } from './types';

// Pages (imported when each phase is built)
import { LobbyPage } from './pages/LobbyPage';
import { GamePage } from './pages/GamePage';
import { ResultPage } from './pages/ResultPage';
import { TournamentEntryPage } from './pages/TournamentEntryPage';
import { AdminPage } from './pages/AdminPage';
import { GameGuidePage } from './pages/GameGuidePage';

// ── Page types ────────────────────────────────────────────────────────────────

export type PageName = 'lobby' | 'game' | 'result' | 'tournament-entry' | 'admin' | 'guide';

export interface PageContext {
  tournamentType?: TournamentType;
  resultSessionId?: string;
}

// ── App shell ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<PageName>('lobby');
  const [pageCtx, setPageCtx] = useState<PageContext>({});

  const navigate = (to: PageName, ctx: PageContext = {}) => {
    setPageCtx(ctx);
    setPage(to);
  };

  return (
    <WalletProvider>
      <AuthProvider>
        <WsProvider>
          {page === 'lobby'            && <LobbyPage navigate={navigate} />}
          {page === 'game'             && <GamePage  navigate={navigate} ctx={pageCtx} />}
          {page === 'result'           && <ResultPage navigate={navigate} ctx={pageCtx} />}
          {page === 'tournament-entry' && <TournamentEntryPage navigate={navigate} ctx={pageCtx} />}
          {page === 'admin'            && <AdminPage navigate={navigate} />}
          {page === 'guide'            && <GameGuidePage navigate={navigate} />}
        </WsProvider>
      </AuthProvider>
    </WalletProvider>
  );
}

// ── Shared navigation prop type ───────────────────────────────────────────────

export interface NavigateFn {
  (to: PageName, ctx?: PageContext): void;
}
