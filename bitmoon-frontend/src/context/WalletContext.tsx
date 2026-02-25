import { createContext, useContext, type ReactNode } from 'react';
import { useWallet, type WalletState, type WalletActions } from '../hooks/useWallet';

type WalletContextValue = WalletState & WalletActions;

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWalletContext must be used inside WalletProvider');
  return ctx;
}
