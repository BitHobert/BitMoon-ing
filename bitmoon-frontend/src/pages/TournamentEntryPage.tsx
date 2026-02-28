import { useState, useEffect, useCallback } from 'react';
import type { NavigateFn, PageContext } from '../App';
import type { TournamentInfo } from '../types';
import { getTournaments, enterTournament } from '../api/http';
import { useWalletContext } from '../context/WalletContext';
import { useAuthContext } from '../context/AuthContext';
import { JSONRpcProvider } from 'opnet';
import { Address, BinaryWriter, MessageSigner } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

// ─── Config ──────────────────────────────────────────────────────────────────

const OPNET_RPC: string =
  (import.meta.env['VITE_OPNET_RPC_URL'] as string | undefined) ?? 'https://testnet.opnet.org';

function rpcNetwork() {
  if (OPNET_RPC.includes('mainnet')) return networks.bitcoin;
  if (OPNET_RPC.includes('regtest')) return networks.regtest;
  // OPNet testnet is a Signet fork — MUST use opnetTestnet (bech32: "opt"),
  // NOT networks.testnet (Bitcoin testnet4, bech32: "tb").
  return networks.opnetTestnet;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTokens(raw: string, decimals = 8): string {
  const n = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac  = n % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

function shortAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'review' | 'paying' | 'confirming' | 'done' | 'error';

const TYPE_COLORS: Record<string, string> = {
  daily:   'var(--color-blue)',
  weekly:  'var(--color-orange)',
  monthly: '#b975ff',
};

// ─── Component ───────────────────────────────────────────────────────────────

interface Props { navigate: NavigateFn; ctx: PageContext; }

export function TournamentEntryPage({ navigate, ctx }: Props) {
  const wallet = useWalletContext();
  const auth   = useAuthContext();

  const tournamentType = ctx.tournamentType;

  const [tournament, setTournament] = useState<TournamentInfo | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [step,       setStep]       = useState<Step>('review');
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  // ── Load tournament info ───────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentType) { navigate('lobby'); return; }
    getTournaments()
      .then((r) => {
        const t = r.tournaments.find((x) => x.tournamentType === tournamentType);
        if (!t) { navigate('lobby'); return; }
        setTournament(t);
      })
      .catch(() => navigate('lobby'))
      .finally(() => setLoading(false));
  }, [tournamentType, navigate]);

  // ── Ensure auth token before paying ───────────────────────────────────────
  const ensureToken = useCallback(async (): Promise<string | null> => {
    if (auth.token) return auth.token;
    if (!wallet.address) return null;
    await auth.login(wallet.address, wallet.signMessage, wallet.getPublicKey, tournamentType);
    return auth.token;
  }, [auth, wallet.address, wallet.signMessage, wallet.getPublicKey, tournamentType]);

  // ── Pay entry fee ─────────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!tournament || !wallet.address) return;

    // Tournament entry requires OP_WALLET (UnisatSigner is FORBIDDEN for OPNet contract calls)
    if (!MessageSigner.isOPWalletAvailable()) {
      setErrorMsg(
        'Tournament entry requires the OP_WALLET browser extension.\n' +
        'Unisat can be used to connect and play for free, but OP-20 transfers require OP_WALLET.',
      );
      setStep('error');
      return;
    }

    const token = await ensureToken();
    if (!token) {
      setErrorMsg('Authentication failed. Please reconnect your wallet.');
      setStep('error');
      return;
    }

    setStep('paying');
    setErrorMsg(null);

    try {
      // 1. Fetch UTXOs from OPNet node
      const network  = rpcNetwork();
      const provider = new JSONRpcProvider({ url: OPNET_RPC, network });
      const utxos    = await provider.utxoManager.getUTXOs({
        address:  wallet.address,
        optimize: false,
      });

      // 2. Encode OP-20 transfer(prizeContractAddress, entryFee) calldata
      const writer = new BinaryWriter();
      writer.writeSelector(0xa9059cbb);                         // transfer(address,uint256)
      writer.writeAddress(Address.fromString(tournament.prizeContractAddress));
      writer.writeU256(BigInt(tournament.entryFee));
      const calldata = writer.getBuffer();

      // 3. Sign & broadcast via OP_WALLET (signer-less browser path)
      const opnetWallet = (window as Window & { opnet?: Record<string, unknown> }).opnet!;
      const [, interactionResult] = await (
        opnetWallet['signAndBroadcastInteraction'] as (
          p: Record<string, unknown>,
        ) => Promise<[unknown, { txid: string }, unknown[]]>
      )({
        utxos,
        from:        wallet.address,
        to:          tournament.tokenAddress,
        feeRate:     10,
        priorityFee: 1000n,
        gasSatFee:   500n,
        calldata,
        network,
      });

      const txid = interactionResult.txid;
      setTxHash(txid);

      // 4. Confirm with backend
      setStep('confirming');
      await enterTournament(token, {
        tournamentType: tournament.tournamentType,
        txHash:         txid,
      });

      setStep('done');
      setTimeout(() => navigate('game', { tournamentType: tournament.tournamentType }), 2500);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStep('error');
    }
  }, [tournament, wallet.address, ensureToken, navigate]);

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!wallet.connected) {
    return (
      <CenteredLayout>
        <div className="pixel glow-orange" style={{ fontSize: 12, marginBottom: 16 }}>WALLET REQUIRED</div>
        <p style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', textAlign: 'center', maxWidth: 300, lineHeight: 2, marginBottom: 20 }}>
          Connect your wallet to enter tournaments.
        </p>
        <button className="btn btn-orange" onClick={() => navigate('lobby')}>BACK TO LOBBY</button>
      </CenteredLayout>
    );
  }

  if (loading || !tournament) {
    return (
      <CenteredLayout>
        <p className="pixel" style={{ color: 'var(--color-orange)', fontSize: 10 }}>LOADING…</p>
      </CenteredLayout>
    );
  }

  const color     = TYPE_COLORS[tournament.tournamentType] ?? 'var(--color-orange)';
  const feeTokens = fmtTokens(tournament.entryFee);
  const prizePool = fmtTokens(tournament.prizePool);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--color-bg)', padding: 24, gap: 20,
    }}>
      {/* Title */}
      <div className="pixel glow-orange" style={{ fontSize: 14 }}>ENTER TOURNAMENT</div>

      {/* Card */}
      <div className="card" style={{ minWidth: 340, maxWidth: 460, width: '100%', borderColor: color, boxShadow: `0 0 24px ${color}22` }}>

        {/* Tournament badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span className="pixel" style={{ fontSize: 12, color }}>
            {tournament.tournamentType.toUpperCase()}
          </span>
          {tournament.isActive
            ? <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-green)' }}>● LIVE</span>
            : <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)' }}>INACTIVE</span>
          }
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 8px', marginBottom: 20 }}>
          <Detail label="PRIZE POOL"  value={`${prizePool} tBTC`}  color="var(--color-orange)" />
          <Detail label="ENTRY FEE"   value={`${feeTokens} tBTC`}  color={color} />
          <Detail label="PLAYERS"     value={String(tournament.entrantCount)} color="var(--color-text)" />
          <Detail label="YOUR WALLET" value={shortAddr(wallet.address ?? '')} color="var(--color-text-dim)" />
        </div>

        {/* Step content */}
        {step === 'review' && (
          <>
            <div style={{
              background: 'rgba(247,147,26,0.07)', border: '1px solid rgba(247,147,26,0.2)',
              borderRadius: 3, padding: '10px 14px', marginBottom: 18,
              fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', lineHeight: 2,
            }}>
              Sending entry fee transfers <strong style={{ color: 'var(--color-orange)' }}>{feeTokens} tBTC</strong> to the prize contract.
              Your score will be eligible for the {tournament.tournamentType} prize pool.
            </div>

            {!MessageSigner.isOPWalletAvailable() && (
              <div style={{
                background: 'rgba(231,76,60,0.1)', border: '1px solid var(--color-red)',
                borderRadius: 3, padding: '8px 12px', marginBottom: 14,
                fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-red)', lineHeight: 2,
              }}>
                ⚠ OP_WALLET not detected. Tournament entry requires OP_WALLET extension.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-blue" style={{ flex: 1, fontSize: 8 }} onClick={() => navigate('lobby')}>
                CANCEL
              </button>
              <button
                className="btn btn-solid-orange"
                style={{ flex: 2, fontSize: 8 }}
                onClick={() => void handlePay()}
                disabled={!MessageSigner.isOPWalletAvailable()}
              >
                SEND ENTRY FEE →
              </button>
            </div>
          </>
        )}

        {step === 'paying' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-orange)', marginBottom: 10 }}>
              ⏳ AWAITING WALLET…
            </div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', lineHeight: 2 }}>
              Approve the transaction in your OP_WALLET extension.
            </div>
          </div>
        )}

        {step === 'confirming' && txHash && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-blue)', marginBottom: 10 }}>
              ✓ TX BROADCAST
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--color-text-dim)', wordBreak: 'break-all', marginBottom: 10,
            }}>
              {txHash.slice(0, 12)}…{txHash.slice(-8)}
            </div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)' }}>
              Confirming entry with server…
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div className="pixel glow-orange" style={{ fontSize: 14, marginBottom: 10 }}>🎮 ENTRY CONFIRMED!</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)' }}>
              Starting game…
            </div>
          </div>
        )}

        {step === 'error' && (
          <>
            <div style={{
              background: 'rgba(231,76,60,0.1)', border: '1px solid var(--color-red)',
              borderRadius: 3, padding: '10px 14px', marginBottom: 16,
              fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-red)',
              lineHeight: 2, whiteSpace: 'pre-line',
            }}>
              ⚠ {errorMsg ?? 'An error occurred.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-blue" style={{ flex: 1, fontSize: 8 }} onClick={() => navigate('lobby')}>
                LOBBY
              </button>
              <button
                className="btn btn-orange"
                style={{ flex: 1, fontSize: 8 }}
                onClick={() => { setStep('review'); setErrorMsg(null); }}
              >
                RETRY
              </button>
            </div>
          </>
        )}
      </div>

      {/* Steps indicator */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['review', 'paying', 'confirming', 'done'] as Step[]).map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: step === s ? 'var(--color-orange)' : (
                ['review','paying','confirming','done'].indexOf(step) > i
                  ? 'var(--color-green)' : 'var(--color-border)'
              ),
              boxShadow: step === s ? '0 0 6px var(--color-orange)' : 'none',
              transition: 'all 0.3s',
            }} />
            {i < 3 && <div style={{ width: 20, height: 1, background: 'var(--color-border)' }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CenteredLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: 'var(--color-bg)', gap: 16,
    }}>
      {children}
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color }}>
        {value}
      </div>
    </div>
  );
}
