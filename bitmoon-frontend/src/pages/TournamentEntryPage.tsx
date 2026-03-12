import { useState, useEffect, useCallback } from 'react';
import type { NavigateFn, PageContext } from '../App';
import type { TournamentInfo } from '../types';
import { getTournaments, enterTournament } from '../api/http';
import { useWalletContext } from '../context/WalletContext';
import { useAuthContext } from '../context/AuthContext';

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

type Step = 'review' | 'minting' | 'paying' | 'confirming' | 'done' | 'error';

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
  const [quantity,   setQuantity]   = useState(1);

  // ── Load tournament info ───────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentType) { navigate('home'); return; }
    getTournaments()
      .then((r) => {
        const t = r.tournaments.find((x) => x.tournamentType === tournamentType);
        if (!t) { navigate('home'); return; }
        setTournament(t);
      })
      .catch(() => navigate('home'))
      .finally(() => setLoading(false));
  }, [tournamentType, navigate]);

  // ── Ensure auth token before paying ───────────────────────────────────────
  // NOTE: Do NOT pass tournamentType here — this token is only for the
  // enterTournament API call. The backend's createSession rejects
  // tournament sessions when no verified entry exists yet (chicken-and-egg).
  // The actual tournament game session is created later by GamePage.
  const ensureToken = useCallback(async (): Promise<string | null> => {
    if (auth.token) return auth.token;
    if (!wallet.address) return null;
    const token = await auth.login(wallet.address, wallet.signMessage, wallet.getPublicKey);
    return token;
  }, [auth, wallet.address, wallet.signMessage, wallet.getPublicKey]);

  // ── Pay entry fee ──────────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!tournament || !wallet.address) return;

    let token: string | null;
    try {
      token = await ensureToken();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Auth failed');
      setStep('error');
      return;
    }

    if (!token) {
      setErrorMsg('Authentication failed. Please reconnect your wallet.');
      setStep('error');
      return;
    }

    setStep('paying');
    setErrorMsg(null);

    try {
      let txid: string;

      if (tournament.tokenAddress) {
        // OP-20 token transfer (LFGT or other token) — quantity × fee
        const amount = BigInt(tournament.entryFee) * BigInt(quantity);
        txid = await wallet.sendTokenTransfer(
          tournament.tokenAddress,
          tournament.prizeContractAddress,
          amount,
        );
      } else {
        // Native BTC fallback (for when opnet.web3.sendBitcoin is fixed)
        const satoshis = Number(BigInt(tournament.entryFee) * BigInt(quantity));
        txid = await wallet.sendBitcoin(tournament.prizeContractAddress, satoshis);
      }

      setTxHash(txid);

      // Confirm with backend
      setStep('confirming');
      await enterTournament(token, {
        tournamentType: tournament.tournamentType,
        txHash:         txid,
        quantity,
      });

      setStep('done');
      setTimeout(() => navigate('game', { tournamentType: tournament.tournamentType }), 2500);

    } catch (err: unknown) {
      console.error('[handlePay] error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStep('error');
    }
  }, [tournament, wallet, ensureToken, navigate, quantity]);

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!wallet.connected) {
    return (
      <CenteredLayout>
        <div className="pixel glow-orange" style={{ fontSize: 12, marginBottom: 16 }}>WALLET REQUIRED</div>
        <p style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', textAlign: 'center', maxWidth: 300, lineHeight: 2, marginBottom: 20 }}>
          Connect your wallet to enter tournaments.
        </p>
        <button className="btn btn-orange" onClick={() => navigate('home')}>BACK TO HOME</button>
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

  const color      = TYPE_COLORS[tournament.tournamentType] ?? 'var(--color-orange)';
  const feeTokens  = fmtTokens(tournament.entryFee);
  const totalCost  = fmtTokens((BigInt(tournament.entryFee) * BigInt(quantity)).toString());
  const prizePool  = fmtTokens(tournament.prizePool);
  const tokenLabel = tournament.tokenAddress ? 'LFGT' : 'tBTC';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 60px)', position: 'relative', zIndex: 1, padding: 24, gap: 20,
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
          <Detail label="PRIZE POOL"  value={`${prizePool} ${tokenLabel}`}  color="var(--color-orange)" />
          <Detail label="ENTRY FEE"   value={`${feeTokens} ${tokenLabel}`}  color={color} />
          <Detail label="PLAYERS"     value={String(tournament.entrantCount)} color="var(--color-text)" />
          <Detail label="YOUR WALLET" value={shortAddr(wallet.address ?? '')} color="var(--color-text-dim)" />
          {BigInt(tournament.pendingPool || '0') > 0n && (
            <Detail label="PENDING POOL" value={`${fmtTokens(tournament.pendingPool)} ${tokenLabel}`} color="#ffd700" />
          )}
        </div>

        {/* Purchase deadline warning */}
        {tournament.isPurchaseOpen === false && (
          <div style={{
            background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.3)',
            borderRadius: 3, padding: '8px 12px', marginBottom: 16,
            fontFamily: 'var(--font-pixel)', fontSize: 8, color: '#ffd700',
            textAlign: 'center', lineHeight: 2,
          }}>
            NEW ENTRIES CLOSED — PURCHASE DEADLINE PASSED
          </div>
        )}

        {/* Step content */}
        {step === 'review' && (
          <>
            {/* Quantity selector */}
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontFamily: 'var(--font-pixel)', fontSize: 7,
                color: 'var(--color-text-dim)', marginBottom: 8,
              }}>
                HOW MANY TURNS?
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 3, 5, 10].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: 9,
                      cursor: 'pointer',
                      background: quantity === q ? 'var(--color-orange)' : 'transparent',
                      color:      quantity === q ? '#000' : 'var(--color-text-dim)',
                      border:     `1px solid ${quantity === q ? 'var(--color-orange)' : 'var(--color-border)'}`,
                      borderRadius: 2,
                      transition: 'all 0.15s',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Cost breakdown */}
            <div style={{
              background: 'rgba(247,147,26,0.07)', border: '1px solid rgba(247,147,26,0.2)',
              borderRadius: 3, padding: '10px 14px', marginBottom: 18,
              fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', lineHeight: 2,
            }}>
              {quantity > 1 ? (
                <>
                  <strong style={{ color: 'var(--color-orange)' }}>{quantity} turns</strong> × {feeTokens} {tokenLabel} = <strong style={{ color: 'var(--color-orange)' }}>{totalCost} {tokenLabel}</strong>
                  <br/>
                  Each turn is one game. Every score counts to the leaderboard.
                </>
              ) : (
                <>
                  Sending <strong style={{ color: 'var(--color-orange)' }}>{feeTokens} {tokenLabel}</strong> for 1 turn.
                  Your score will be eligible for the {tournament.tournamentType} prize pool.
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-blue" style={{ flex: 1, fontSize: 8 }} onClick={() => navigate('home')}>
                CANCEL
              </button>
              <button
                className="btn btn-solid-orange"
                style={{ flex: 2, fontSize: 8 }}
                onClick={() => void handlePay()}
              >
                {quantity > 1 ? `BUY ${quantity} TURNS →` : 'SEND ENTRY FEE →'}
              </button>
            </div>
          </>
        )}

        {step === 'minting' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-blue)', marginBottom: 10 }}>
              🪙 MINTING LFGT…
            </div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', lineHeight: 2 }}>
              Approve the mint transaction in your wallet.
            </div>
          </div>
        )}

        {step === 'paying' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-orange)', marginBottom: 10 }}>
              ⏳ AWAITING WALLET…
            </div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', lineHeight: 2 }}>
              Wallet is preparing your transaction.<br/>
              Please wait for it to load, then sign.
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
              {quantity > 1
                ? `${quantity} turns purchased — starting game…`
                : 'Starting game…'
              }
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
              <button className="btn btn-blue" style={{ flex: 1, fontSize: 8 }} onClick={() => navigate('home')}>
                HOME
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
      justifyContent: 'center', minHeight: 'calc(100vh - 60px)', position: 'relative', zIndex: 1, gap: 16,
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
