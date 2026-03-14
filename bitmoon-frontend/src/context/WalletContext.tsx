import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useWalletConnect, SupportedWallets } from '@btc-vision/walletconnect';
import { TransactionFactory, MessageSigner, Address } from '@btc-vision/transaction';
import { getContract, IOP20Contract, OP_20_ABI } from 'opnet';
import { IS_MAINNET } from '../config/network';

const DEV = import.meta.env.DEV;

// ── Public interface (unchanged for consumers) ──────────────────────────────

export type WalletType = 'opnet' | 'unisat' | null;

export interface WalletContextValue {
  // State
  type: WalletType;
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  /** True when the wallet is connected to a different network than the app expects */
  networkMismatch: boolean;

  // Actions
  connect: (preferred?: WalletType) => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<string>;
  getPublicKey: () => Promise<string>;
  sendBitcoin: (toAddress: string, satoshis: number) => Promise<string>;
  sendTokenTransfer: (tokenAddress: string, toAddress: string, amount: bigint) => Promise<string>;
  detectWallet: () => WalletType;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// ── Adapter: wraps useWalletConnect() into our app's interface ──────────────

function useWalletAdapter(): WalletContextValue {
  const wc = useWalletConnect();

  const connected = !!wc.walletAddress;

  // Detect network mismatch: compare wallet's chainType against expected network
  const networkMismatch = useMemo(() => {
    if (!connected || !wc.network) return false;
    const walletChain = (wc.network as { chainType?: string }).chainType ?? '';
    if (IS_MAINNET) {
      // On mainnet build, wallet should be on BITCOIN_MAINNET
      return walletChain !== 'BITCOIN_MAINNET';
    }
    // On testnet build, wallet should be on OPNET_TESTNET
    return walletChain !== 'OPNET_TESTNET';
  }, [connected, wc.network]);

  const type: WalletType = wc.walletType === 'OP_WALLET'
    ? 'opnet'
    : wc.walletType === 'UNISAT'
      ? 'unisat'
      : null;

  const detectWallet = useCallback((): WalletType => {
    const opInstalled = wc.allWallets.find((w) => w.name === SupportedWallets.OP_WALLET);
    if (opInstalled?.isInstalled) return 'opnet';
    const uniInstalled = wc.allWallets.find((w) => w.name === SupportedWallets.UNISAT);
    if (uniInstalled?.isInstalled) return 'unisat';
    return null;
  }, [wc.allWallets]);

  const connect = useCallback(async (preferred?: WalletType) => {
    const target = preferred === 'unisat'
      ? SupportedWallets.UNISAT
      : SupportedWallets.OP_WALLET;
    wc.connectToWallet(target);
  }, [wc]);

  const disconnect = useCallback(() => {
    wc.disconnect();
  }, [wc]);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!connected) throw new Error('Wallet not connected');
    const result = await MessageSigner.signMessageAuto(message);
    const bytes = result.signature as unknown as Uint8Array;
    return btoa(String.fromCharCode(...Array.from(bytes)));
  }, [connected]);

  const getPublicKey = useCallback(async (): Promise<string> => {
    if (!connected || !wc.publicKey) throw new Error('Wallet not connected');
    return wc.publicKey;
  }, [connected, wc.publicKey]);

  const sendBitcoin = useCallback(async (toAddress: string, satoshis: number): Promise<string> => {
    if (!connected || !wc.walletAddress || !wc.provider || !wc.network) {
      throw new Error('Wallet not connected');
    }
    if (!wc.signer) {
      throw new Error('Wallet signer not available — try reconnecting');
    }

    if (DEV) console.log('[sendBitcoin] TransactionFactory + walletconnect signer', {
      to: toAddress, satoshis, from: wc.walletAddress,
      signerType: wc.signer.constructor.name,
    });

    // 1. Fetch UTXOs — optimize MUST be false per OPNet rules
    const utxos = await wc.provider.utxoManager.getUTXOs({
      address: wc.walletAddress,
      optimize: false,
    });

    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs found — wallet may have zero balance');
    }

    if (DEV) console.log('[sendBitcoin] UTXOs fetched:', utxos.length);

    // 2. Build + sign transaction using the walletconnect signer
    //    (bypasses detectFundingOPWallet which calls the broken opnet.web3.sendBitcoin)
    const factory = new TransactionFactory();
    const result = await factory.createBTCTransfer({
      signer: wc.signer,
      mldsaSigner: null,
      network: wc.network,
      utxos,
      from: wc.walletAddress,
      to: toAddress,
      feeRate: 10,
      amount: BigInt(satoshis),
      priorityFee: 0n,
      gasSatFee: 0n,
    });

    if (DEV) console.log('[sendBitcoin] Transaction built, broadcasting...');

    // 3. Broadcast
    const broadcast = await wc.provider.sendRawTransaction(result.tx, false);
    if (!broadcast?.result) {
      throw new Error(broadcast?.error ?? 'Broadcast failed — no txid returned');
    }

    if (DEV) console.log('[sendBitcoin] SUCCESS, txid:', broadcast.result);
    return broadcast.result;
  }, [connected, wc.walletAddress, wc.provider, wc.network, wc.signer]);

  // ── OP-20 token transfer (contract interaction path) ──────────────────────
  const sendTokenTransfer = useCallback(async (
    tokenAddress: string,
    toAddress: string,
    amount: bigint,
  ): Promise<string> => {
    if (!connected || !wc.provider || !wc.network || !wc.walletAddress || !wc.address) {
      throw new Error('Wallet not connected');
    }

    if (DEV) console.log('[sendTokenTransfer] starting', {
      token: tokenAddress, to: toAddress, amount: amount.toString(),
      from: wc.walletAddress,
    });

    // 1. Build contract instance
    //    Use wc.address (Address object from walletconnect) — NOT Address.fromString(opt1p...)
    //    Address.fromString() requires hex public keys, not bech32 addresses
    const contract = getContract<IOP20Contract>(
      Address.fromString(tokenAddress),  // token contract is already 0x... hex
      OP_20_ABI,
      wc.provider,
      wc.network,
      wc.address,  // sender — already an Address object from walletconnect
    );

    // 2. Resolve recipient address
    //    getPublicKeyInfo(address, isContract) returns Address directly
    if (DEV) console.log('[sendTokenTransfer] resolving recipient address...');
    const recipientAddress = await wc.provider.getPublicKeyInfo(toAddress, false);
    if (!recipientAddress) {
      throw new Error(
        `Cannot resolve address for ${toAddress.slice(0, 12)}…. ` +
        `The recipient may not have interacted on-chain yet.`
      );
    }
    if (DEV) console.log('[sendTokenTransfer] recipient resolved OK');

    // 3. Simulate the transfer
    if (DEV) console.log('[sendTokenTransfer] simulating transfer...');
    const sim = await contract.transfer(recipientAddress, amount);

    // Check for revert (use .revert per OPNet convention, not 'error' in sim)
    if (sim.revert) {
      throw new Error(`Transfer reverted: ${sim.revert}`);
    }

    if (DEV) console.log('[sendTokenTransfer] simulation OK, requesting wallet signature...');

    // 4. Send — signer & mldsaSigner are ALWAYS null on frontend
    //    The wallet extension (OP_WALLET) handles signing via detectInteractionOPWallet
    const receipt = await sim.sendTransaction({
      signer: null as any,       // ALWAYS null on frontend — wallet signs
      mldsaSigner: null,         // ALWAYS null on frontend — wallet signs
      refundTo: wc.walletAddress,
      maximumAllowedSatToSpend: 500_000n,
      network: wc.network,
    });

    if (DEV) console.log('[sendTokenTransfer] SUCCESS, txid:', receipt.transactionId);
    return receipt.transactionId;
  }, [connected, wc.provider, wc.network, wc.walletAddress, wc.address]);

  return {
    type,
    address: wc.walletAddress,
    connected,
    connecting: wc.connecting,
    error: null,
    networkMismatch,
    connect,
    disconnect,
    signMessage,
    getPublicKey,
    sendBitcoin,
    sendTokenTransfer,
    detectWallet,
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletAdapter();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWalletContext must be used inside WalletProvider');
  return ctx;
}
