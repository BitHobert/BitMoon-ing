import { useState, useCallback, useEffect } from 'react';
import { MessageSigner, UnisatSigner } from '@btc-vision/transaction';

export type WalletType = 'opnet' | 'unisat' | null;

export interface WalletState {
  type: WalletType;
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

export interface WalletActions {
  connect: (preferred?: WalletType) => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<string>;
  getPublicKey: () => Promise<string>;
  detectWallet: () => WalletType;
}

const initialState: WalletState = {
  type: null,
  address: null,
  connected: false,
  connecting: false,
  error: null,
};

export function useWallet(): WalletState & WalletActions {
  const [state, setState] = useState<WalletState>(initialState);

  const detectWallet = useCallback((): WalletType => {
    if (typeof window === 'undefined') return null;
    if (MessageSigner.isOPWalletAvailable()) return 'opnet';
    if (typeof (window as Window & { unisat?: unknown }).unisat !== 'undefined') return 'unisat';
    return null;
  }, []);

  // Auto-detect on mount
  useEffect(() => {
    const detected = detectWallet();
    if (detected) {
      setState((s) => ({ ...s, type: detected }));
    }
  }, [detectWallet]);

  const connect = useCallback(async (preferred?: WalletType) => {
    const walletType = preferred ?? detectWallet();
    if (!walletType) {
      setState((s) => ({ ...s, error: 'No wallet found. Install OP_WALLET or Unisat.' }));
      return;
    }

    setState((s) => ({ ...s, connecting: true, error: null, type: walletType }));

    try {
      let address: string;

      if (walletType === 'opnet') {
        // OP_WALLET: request accounts via window.opnet
        const opnet = (window as Window & { opnet?: { requestAccounts: () => Promise<string[]> } }).opnet;
        if (!opnet) throw new Error('OP_WALLET not available');
        const accounts = await opnet.requestAccounts();
        if (!accounts || accounts.length === 0) throw new Error('No accounts returned from OP_WALLET');
        address = accounts[0];
      } else {
        // Unisat: use UnisatSigner to derive P2TR address
        const signer = new UnisatSigner();
        await signer.init();
        address = signer.p2tr;
      }

      setState({ type: walletType, address, connected: true, connecting: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setState((s) => ({ ...s, connecting: false, error: message }));
    }
  }, [detectWallet]);

  const disconnect = useCallback(() => {
    setState(initialState);
  }, []);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!state.connected || !state.type) throw new Error('Wallet not connected');

    if (state.type === 'opnet') {
      const result = await MessageSigner.signMessageAuto(message);
      // Convert Uint8Array signature to base64 string (matches Unisat bip322-simple format)
      const bytes = result.signature as unknown as Uint8Array;
      return btoa(String.fromCharCode(...Array.from(bytes)));
    } else {
      // Unisat
      const unisat = (window as Window & { unisat?: { signMessage: (msg: string, type: string) => Promise<string> } }).unisat;
      if (!unisat) throw new Error('Unisat not available');
      return unisat.signMessage(message, 'bip322-simple');
    }
  }, [state.connected, state.type]);

  const getPublicKey = useCallback(async (): Promise<string> => {
    if (!state.connected || !state.type) throw new Error('Wallet not connected');

    if (state.type === 'opnet') {
      // OP_WALLET extends Unisat — both expose getPublicKey()
      const opnet = (window as Window & { opnet?: { getPublicKey: () => Promise<string> } }).opnet;
      if (!opnet) throw new Error('OP_WALLET not available');
      return opnet.getPublicKey();
    } else {
      // Unisat
      const unisat = (window as Window & { unisat?: { getPublicKey: () => Promise<string> } }).unisat;
      if (!unisat) throw new Error('Unisat not available');
      return unisat.getPublicKey();
    }
  }, [state.connected, state.type]);

  return { ...state, connect, disconnect, signMessage, getPublicKey, detectWallet };
}
