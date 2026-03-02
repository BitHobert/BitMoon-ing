import { useState, useCallback, useEffect } from 'react';
import { MessageSigner, TransactionFactory, UnisatSigner, type Unisat } from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks, Psbt } from '@btc-vision/bitcoin';

/**
 * Subclass of UnisatSigner that targets window.opnet instead of window.unisat.
 *
 * Fixes OP_WALLET / SDK incompatibilities:
 * 1. Redirects wallet calls to window.opnet (not window.unisat)
 * 2. Fixes getNetwork() returning "livenet" → "opnetTestnet"
 * 3. Strips tapInternalKey from PSBT before signing to bypass OP_WALLET's
 *    broken checkTaprootHashesForSig (compares 33B key vs 32B tapInternalKey
 *    without toXOnly() conversion — always mismatches).
 */
class OPWalletSigner extends UnisatSigner {
  public override get unisat(): Unisat {
    const opnet = (window as WindowAny).opnet as Unisat | undefined;
    if (!opnet) throw new Error('OP_WALLET not available');
    return new Proxy(opnet, {
      get(target: Unisat, prop: string | symbol) {
        if (prop === 'getNetwork') {
          return async () => 'opnetTestnet';
        }
        const val = target[prop as keyof Unisat];
        return typeof val === 'function' ? (val as Function).bind(target) : val;
      },
    });
  }

  /**
   * Override multiSignPsbt to strip tapInternalKey before sending to OP_WALLET.
   *
   * OP_WALLET's checkTaprootHashesForSig compares tapInternalKey (32-byte) against
   * the keyring's 33-byte key WITHOUT toXOnly(). By stripping tapInternalKey,
   * the wallet should detect taproot from witnessUtxo script (OP_1 <32B key>)
   * and sign using its own key-path logic.
   *
   * Copies any resulting signatures back into the original PSBT.
   */
  public override async multiSignPsbt(transactions: Psbt[]): Promise<void> {
    const psbt = transactions[0];
    if (!psbt) throw new Error('No PSBT to sign');

    // Log input structure for diagnostics
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i];
      const keys = input ? Object.keys(input) : [];
      console.log(`[OPWalletSigner] input[${i}] keys:`, keys.join(', '),
        'tapInternalKey?', input?.tapInternalKey ? input.tapInternalKey.length + 'B' : 'MISSING',
        'witnessUtxo?', !!input?.witnessUtxo);
    }

    // Clone PSBT and STRIP tapInternalKey from all inputs.
    // This prevents checkTaprootHashesForSig from doing the broken 33B vs 32B comparison.
    const strippedPsbt = Psbt.fromHex(psbt.toHex());
    for (let i = 0; i < strippedPsbt.data.inputs.length; i++) {
      const input = strippedPsbt.data.inputs[i];
      if (input?.tapInternalKey) {
        console.log(`[OPWalletSigner] stripping tapInternalKey from input ${i}`);
        delete (input as Record<string, unknown>).tapInternalKey;
      }
    }

    const strippedHex = strippedPsbt.toHex();
    console.log('[OPWalletSigner] stripped PSBT hex length:', strippedHex.length);

    try {
      const signed = await this.unisat.signPsbt(strippedHex, { autoFinalized: false });
      console.log('[OPWalletSigner] signPsbt OK, len:', signed?.length);

      // Parse the signed PSBT and copy signatures into the original PSBT
      const signedPsbt = Psbt.fromHex(signed);
      for (let i = 0; i < psbt.data.inputs.length; i++) {
        const signedInput = signedPsbt.data.inputs[i];
        if (!signedInput) continue;

        if (signedInput.tapKeySig) {
          psbt.updateInput(i, { tapKeySig: signedInput.tapKeySig });
        }
        if (signedInput.tapScriptSig?.length) {
          psbt.updateInput(i, { tapScriptSig: signedInput.tapScriptSig });
        }
        if (signedInput.partialSig?.length) {
          psbt.updateInput(i, { partialSig: signedInput.partialSig });
        }
      }
      return;
    } catch (err) {
      console.error('[OPWalletSigner] signPsbt with stripped tapInternalKey FAILED:', err);
      throw err;
    }
  }
}

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
  sendBitcoin: (toAddress: string, satoshis: number) => Promise<string>;
  detectWallet: () => WalletType;
}

const initialState: WalletState = {
  type: null,
  address: null,
  connected: false,
  connecting: false,
  error: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WindowAny = Window & Record<string, any>;

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
        // Unisat: get accounts directly from window.unisat
        const unisat = (window as Window & { unisat?: { requestAccounts: () => Promise<string[]> } }).unisat;
        if (!unisat) throw new Error('Unisat not available');
        const accounts = await unisat.requestAccounts();
        if (!accounts || accounts.length === 0) throw new Error('No accounts returned from Unisat');
        address = accounts[0];
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

  const sendBitcoin = useCallback(async (toAddress: string, satoshis: number): Promise<string> => {
    if (!state.connected || !state.type || !state.address) throw new Error('Wallet not connected');

    if (state.type === 'opnet') {
      // ─── Strategy A: Direct wallet sendBitcoin() ─────────────────────
      // Try the high-level wallet API first. This is the simplest path where
      // the wallet handles UTXO selection, PSBT building, signing, and broadcast.
      // Wraps in a timeout because some wallet versions hang on this call.
      // ──────────────────────────────────────────────────────────────────
      const win = window as WindowAny;
      const opnetWallet = win.opnet as Record<string, unknown> | undefined;

      if (opnetWallet && typeof opnetWallet.sendBitcoin === 'function') {
        console.log('[sendBitcoin] Strategy A: trying window.opnet.sendBitcoin() directly');
        try {
          const sendFn = opnetWallet.sendBitcoin as (
            to: string, amount: number, opts?: { feeRate: number }
          ) => Promise<string>;

          // Race against a 90-second timeout
          const txid = await Promise.race([
            sendFn(toAddress, satoshis, { feeRate: 10 }),
            new Promise<never>((_resolve, reject) =>
              setTimeout(() => reject(new Error('sendBitcoin timeout after 90s')), 90_000),
            ),
          ]);

          if (txid) {
            console.log('[sendBitcoin] Strategy A SUCCESS, txid:', txid);
            return txid;
          }
        } catch (err) {
          console.warn('[sendBitcoin] Strategy A failed:', err instanceof Error ? err.message : err);
          // Fall through to Strategy B
        }
      } else {
        console.log('[sendBitcoin] Strategy A: sendBitcoin not available on window.opnet');
      }

      // ─── Strategy B: TransactionFactory + OPWalletSigner ─────────────
      // Build PSBT via TransactionFactory, sign via OPWalletSigner which
      // strips tapInternalKey to bypass OP_WALLET's broken checkTaprootHashesForSig.
      //
      // We temporarily remove web3 to bypass detectFundingOPWallet() which
      // tries web3.sendBitcoin() (doesn't exist in current OP_WALLET).
      // ──────────────────────────────────────────────────────────────────
      console.log('[sendBitcoin] Strategy B: TransactionFactory + stripped tapInternalKey');

      const network = networks.opnetTestnet;
      const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network });
      const factory = new TransactionFactory();

      const utxos = await provider.utxoManager.getUTXOs({
        address: state.address,
        optimize: false,
      });

      if (!utxos || utxos.length === 0) {
        throw new Error('No UTXOs found — wallet may have zero balance');
      }

      // Temporarily disable web3 so the factory skips the broken detection path.
      const origWeb3 = opnetWallet?.web3;
      if (opnetWallet) opnetWallet.web3 = undefined;

      try {
        const signer = new OPWalletSigner();
        await signer.init();
        console.log('[sendBitcoin] signer init OK, p2tr:', signer.p2tr, 'p2wpkh:', signer.p2wpkh);
        console.log('[sendBitcoin] from:', state.address, 'to:', toAddress, 'amount:', satoshis);
        console.log('[sendBitcoin] utxos count:', utxos.length);

        const result = await factory.createBTCTransfer({
          signer,
          mldsaSigner: null,
          network,
          utxos,
          from: state.address,
          to: toAddress,
          feeRate: 10,
          amount: BigInt(satoshis),
          priorityFee: 0n,
          gasSatFee: 0n,
        });

        const broadcast = await provider.sendRawTransaction(result.tx, false);
        if (!broadcast?.result) {
          throw new Error(broadcast?.error ?? 'Broadcast failed — no txid returned');
        }

        console.log('[sendBitcoin] Strategy B SUCCESS, txid:', broadcast.result);
        return broadcast.result;
      } finally {
        if (opnetWallet) opnetWallet.web3 = origWeb3;
      }
    }

    // Unisat fallback — simple API
    const unisat = (window as WindowAny).unisat as
      { sendBitcoin: (to: string, sats: number, opts?: { feeRate: number }) => Promise<string> } | undefined;
    if (!unisat) throw new Error('Unisat not available');
    return unisat.sendBitcoin(toAddress, satoshis, { feeRate: 10 });
  }, [state.connected, state.type, state.address]);

  return { ...state, connect, disconnect, signMessage, getPublicKey, sendBitcoin, detectWallet };
}
