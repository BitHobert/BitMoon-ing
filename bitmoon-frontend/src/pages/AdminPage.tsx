import { useState } from 'react';
import type { NavigateFn } from '../App';
import type { TournamentType, SponsorBonus } from '../types';
import { adminDepositBonus, adminGetBonuses } from '../api/http';

interface Props { navigate: NavigateFn; }

const TOURNAMENT_TYPES: TournamentType[] = ['daily', 'weekly', 'monthly'];

function truncate(s: string, len = 12): string {
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatTokens(raw: string, decimals = 8): string {
  const n = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac  = n % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function AdminPage({ navigate }: Props) {
  // Auth
  const [adminSecret, setAdminSecret] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  // Deposit form
  const [depositType, setDepositType]         = useState<TournamentType>('daily');
  const [depositPeriodKey, setDepositPeriodKey] = useState('');
  const [depositToken, setDepositToken]       = useState('');
  const [depositSymbol, setDepositSymbol]     = useState('');
  const [depositAmount, setDepositAmount]     = useState('');
  const [depositStatus, setDepositStatus]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [depositing, setDepositing]           = useState(false);

  // Query
  const [queryType, setQueryType]         = useState<TournamentType>('daily');
  const [queryPeriodKey, setQueryPeriodKey] = useState('');
  const [bonuses, setBonuses]             = useState<SponsorBonus[] | null>(null);
  const [querying, setQuerying]           = useState(false);
  const [queryError, setQueryError]       = useState('');

  const handleAuth = () => {
    if (adminSecret.trim().length > 0) setAuthenticated(true);
  };

  const handleDeposit = async () => {
    setDepositStatus(null);
    setDepositing(true);
    try {
      const result = await adminDepositBonus(adminSecret, {
        tournamentType: depositType,
        periodKey: depositPeriodKey,
        tokenAddress: depositToken.trim(),
        tokenSymbol: depositSymbol.trim().toUpperCase(),
        amount: depositAmount.trim(),
      });
      setDepositStatus({ ok: true, msg: `Deposited! Slot #${result.bonus.slotIndex} — tx: ${truncate(result.bonus.txHash, 20)}` });
      setDepositAmount('');
    } catch (err: unknown) {
      setDepositStatus({ ok: false, msg: (err as Error).message });
    } finally {
      setDepositing(false);
    }
  };

  const handleQuery = async () => {
    setQueryError('');
    setBonuses(null);
    setQuerying(true);
    try {
      const result = await adminGetBonuses(adminSecret, queryType, queryPeriodKey);
      setBonuses(result.bonuses);
    } catch (err: unknown) {
      setQueryError((err as Error).message);
    } finally {
      setQuerying(false);
    }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    padding: '8px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    borderRadius: 4,
    width: '100%',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 8,
    fontFamily: 'var(--font-pixel)',
    color: 'var(--color-text-dim)',
    marginBottom: 4,
    display: 'block',
  };

  // ── Auth screen ──────────────────────────────────────────────────────────────

  if (!authenticated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-bg)', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 className="pixel glow-orange" style={{ fontSize: 14, textAlign: 'center' }}>ADMIN PANEL</h1>
          <p style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center' }}>
            Enter admin secret to continue
          </p>
          <input
            type="password"
            placeholder="Admin secret…"
            value={adminSecret}
            onChange={e => setAdminSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-blue" style={{ flex: 1, fontSize: 9 }} onClick={() => navigate('lobby')}>
              ← BACK
            </button>
            <button className="btn btn-solid-orange" style={{ flex: 1, fontSize: 9 }} onClick={handleAuth}>
              UNLOCK
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main admin panel ──────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-card)', gap: 16, flexWrap: 'wrap',
      }}>
        <div className="pixel glow-orange" style={{ fontSize: 14, letterSpacing: 2 }}>ADMIN</div>
        <button className="btn btn-blue" style={{ fontSize: 8 }} onClick={() => navigate('lobby')}>
          ← LOBBY
        </button>
      </header>

      <main style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* ── Deposit Sponsor Bonus ────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="pixel" style={{ fontSize: 10, color: 'var(--color-orange)' }}>
            ⭐ DEPOSIT SPONSOR BONUS
          </h2>
          <p style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            Record an on-chain sponsor bonus deposit for a tournament period.
            The sponsor must have already transferred tokens to the PrizeDistributor contract.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>TOURNAMENT TYPE</label>
              <select value={depositType} onChange={e => setDepositType(e.target.value as TournamentType)} style={selectStyle}>
                {TOURNAMENT_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>PERIOD KEY (BLOCK #)</label>
              <input
                type="text"
                placeholder="e.g. 1000"
                value={depositPeriodKey}
                onChange={e => setDepositPeriodKey(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 3, minWidth: 200 }}>
              <label style={labelStyle}>TOKEN ADDRESS</label>
              <input
                type="text"
                placeholder="OP-20 token contract address"
                value={depositToken}
                onChange={e => setDepositToken(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={labelStyle}>TOKEN SYMBOL</label>
              <input
                type="text"
                placeholder="e.g. MOTO"
                value={depositSymbol}
                onChange={e => setDepositSymbol(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>AMOUNT (RAW TOKEN UNITS)</label>
            <input
              type="text"
              placeholder="e.g. 100000000 (= 1.0 with 8 decimals)"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              style={inputStyle}
            />
          </div>

          <button
            className="btn btn-solid-orange"
            style={{ fontSize: 9, alignSelf: 'flex-start', padding: '10px 24px' }}
            onClick={handleDeposit}
            disabled={depositing || !depositPeriodKey || !depositToken || !depositSymbol || !depositAmount}
          >
            {depositing ? 'DEPOSITING…' : 'DEPOSIT BONUS'}
          </button>

          {depositStatus && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: depositStatus.ok ? 'rgba(57,255,20,0.1)' : 'rgba(255,59,59,0.1)',
              border: `1px solid ${depositStatus.ok ? 'var(--color-green)' : 'var(--color-red)'}`,
              color: depositStatus.ok ? 'var(--color-green)' : 'var(--color-red)',
            }}>
              {depositStatus.msg}
            </div>
          )}
        </section>

        {/* ── Query Existing Bonuses ───────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="pixel" style={{ fontSize: 10, color: 'var(--color-blue)' }}>
            🔍 QUERY SPONSOR BONUSES
          </h2>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>TOURNAMENT TYPE</label>
              <select value={queryType} onChange={e => setQueryType(e.target.value as TournamentType)} style={selectStyle}>
                {TOURNAMENT_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={labelStyle}>PERIOD KEY (BLOCK #)</label>
              <input
                type="text"
                placeholder="e.g. 1000"
                value={queryPeriodKey}
                onChange={e => setQueryPeriodKey(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button
              className="btn btn-blue"
              style={{ fontSize: 9, padding: '10px 20px', whiteSpace: 'nowrap' }}
              onClick={handleQuery}
              disabled={querying || !queryPeriodKey}
            >
              {querying ? 'LOADING…' : 'QUERY'}
            </button>
          </div>

          {queryError && (
            <div style={{
              padding: '8px 12px', borderRadius: 4, fontSize: 10,
              fontFamily: 'var(--font-mono)', background: 'rgba(255,59,59,0.1)',
              border: '1px solid var(--color-red)', color: 'var(--color-red)',
            }}>
              {queryError}
            </div>
          )}

          {bonuses !== null && (
            bonuses.length === 0 ? (
              <p style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                No sponsor bonuses found for this period.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 10,
                }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['SLOT', 'SYMBOL', 'TOKEN', 'AMOUNT', 'TX HASH', 'DATE'].map(h => (
                        <th key={h} style={{
                          padding: '8px 6px', textAlign: 'left',
                          fontFamily: 'var(--font-pixel)', fontSize: 7,
                          color: 'var(--color-text-dim)',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bonuses.map((b, i) => (
                      <tr key={b._id} style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                      }}>
                        <td style={{ padding: '6px', color: 'var(--color-orange)' }}>#{b.slotIndex}</td>
                        <td style={{ padding: '6px', color: 'var(--color-green)', fontFamily: 'var(--font-pixel)' }}>
                          {b.tokenSymbol}
                        </td>
                        <td style={{ padding: '6px', color: 'var(--color-text)' }} title={b.tokenAddress}>
                          {truncate(b.tokenAddress)}
                        </td>
                        <td style={{ padding: '6px', color: 'var(--color-green)' }}>
                          {formatTokens(b.amount)}
                        </td>
                        <td style={{ padding: '6px', color: 'var(--color-text-dim)' }} title={b.txHash}>
                          {truncate(b.txHash, 16)}
                        </td>
                        <td style={{ padding: '6px', color: 'var(--color-text-dim)' }}>
                          {new Date(b.depositedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </section>

      </main>

      {/* Footer */}
      <footer style={{
        padding: '10px 24px', borderTop: '1px solid var(--color-border)',
        fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>BITMOON'ING ADMIN</span>
        <span style={{ color: 'var(--color-green)' }}>● CONNECTED</span>
      </footer>
    </div>
  );
}
