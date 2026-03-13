import { useState } from 'react';
import type { NavigateFn } from '../App';
import type { TournamentType, SponsorBonus, SponsorPlatform, SponsorLink, PrizeShare } from '../types';
import { adminDepositBonus, adminGetBonuses } from '../api/http';
import { SponsorIcons } from '../components/SponsorIcons';

interface Props { navigate: NavigateFn; }

const TOURNAMENT_TYPES: TournamentType[] = ['daily', 'weekly', 'monthly'];
const PLATFORM_OPTIONS: { value: SponsorPlatform; label: string }[] = [
  { value: 'x',         label: 'X (Twitter)' },
  { value: 'telegram',  label: 'Telegram' },
  { value: 'website',   label: 'Website' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'discord',   label: 'Discord' },
  { value: 'youtube',   label: 'YouTube' },
];
interface LinkRow { platform: SponsorPlatform; url: string; }

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
  const [depositDecimals, setDepositDecimals] = useState(8);
  const [depositLinks, setDepositLinks]       = useState<LinkRow[]>([]);
  const [depositShares, setDepositShares]     = useState<PrizeShare[]>([{ place: 1, percent: 100 }]);
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
      // Build links array — only include rows with a URL filled in
      const links: SponsorLink[] = depositLinks
        .filter(l => l.url.trim().length > 0)
        .map(l => ({ platform: l.platform, url: l.url.trim() }));

      // Convert human-readable amount → raw token units
      const rawAmount = BigInt(Math.round(parseFloat(depositAmount.trim()) * (10 ** depositDecimals))).toString();

      const result = await adminDepositBonus(adminSecret, {
        tournamentType: depositType,
        periodKey: depositPeriodKey,
        tokenAddress: depositToken.trim(),
        tokenSymbol: depositSymbol.trim().toUpperCase(),
        amount: rawAmount,
        decimals: depositDecimals,
        ...(links.length > 0 ? { links } : {}),
        prizeShares: depositShares,
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
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)', position: 'relative', zIndex: 1, alignItems: 'center', justifyContent: 'center' }}>
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
            <button className="btn btn-blue" style={{ flex: 1, fontSize: 9 }} onClick={() => navigate('home')}>
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
    <div style={{
      position: 'relative', zIndex: 1,
      padding: '24px 20px', maxWidth: 900, margin: '0 auto', width: '100%',
      display: 'flex', flexDirection: 'column', gap: 24,
      minHeight: 'calc(100vh - 60px)',
    }}>
      {/* Page title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="btn btn-orange"
          style={{ fontSize: 8, padding: '6px 12px' }}
          onClick={() => navigate('home')}
        >
          ← HOME
        </button>
        <h1 className="pixel glow-orange" style={{ fontSize: 14, margin: 0 }}>ADMIN</h1>
      </div>

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

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 3, minWidth: 180 }}>
              <label style={labelStyle}>AMOUNT (HUMAN-READABLE)</label>
              <input
                type="text"
                placeholder="e.g. 1000"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={labelStyle}>DECIMALS</label>
              <select
                value={depositDecimals}
                onChange={e => setDepositDecimals(Number(e.target.value))}
                style={selectStyle}
              >
                {[0, 2, 4, 6, 8, 10, 18].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Live raw-unit preview */}
          {depositAmount && /^\d+(\.\d+)?$/.test(depositAmount.trim()) && (
            <div style={{
              padding: '6px 12px', borderRadius: 4, fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'rgba(74,158,255,0.08)',
              border: '1px solid rgba(74,158,255,0.2)',
              color: 'var(--color-blue)',
            }}>
              → {BigInt(Math.round(parseFloat(depositAmount.trim()) * (10 ** depositDecimals))).toLocaleString()} raw units
              ({depositAmount.trim()} × 10^{depositDecimals})
            </div>
          )}

          {/* ── Sponsor Links (optional, up to 3) ──────────────────────── */}
          <div>
            <label style={labelStyle}>SPONSOR LINKS (OPTIONAL — UP TO 3)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {depositLinks.map((row, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={row.platform}
                    onChange={e => {
                      const next = [...depositLinks];
                      next[idx] = { ...row, platform: e.target.value as SponsorPlatform };
                      setDepositLinks(next);
                    }}
                    style={{ ...selectStyle, width: 140, flex: 'none' }}
                  >
                    {PLATFORM_OPTIONS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="https://…"
                    value={row.url}
                    onChange={e => {
                      const next = [...depositLinks];
                      next[idx] = { ...row, url: e.target.value };
                      setDepositLinks(next);
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setDepositLinks(depositLinks.filter((_, i) => i !== idx))}
                    style={{
                      background: 'none', border: 'none', color: 'var(--color-red)',
                      cursor: 'pointer', fontSize: 14, padding: '4px 8px', lineHeight: 1,
                    }}
                    title="Remove link"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {depositLinks.length < 3 && (
                <button
                  type="button"
                  className="btn btn-blue"
                  style={{ fontSize: 8, padding: '6px 14px', alignSelf: 'flex-start' }}
                  onClick={() => setDepositLinks([...depositLinks, { platform: 'x', url: '' }])}
                >
                  + ADD LINK
                </button>
              )}
            </div>
          </div>

          {/* ── Prize Distribution ──────────────────────────────────── */}
          <div>
            <label style={labelStyle}>PRIZE DISTRIBUTION</label>
            {/* Presets */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-blue"
                style={{
                  fontSize: 8, padding: '5px 12px',
                  ...(depositShares.length === 1 && depositShares[0].place === 1 && depositShares[0].percent === 100
                    ? { background: 'rgba(0,212,255,0.15)', boxShadow: '0 0 8px rgba(0,212,255,0.3)' } : {}),
                }}
                onClick={() => setDepositShares([{ place: 1, percent: 100 }])}
              >
                1ST ONLY (100%)
              </button>
              <button
                type="button"
                className="btn btn-blue"
                style={{
                  fontSize: 8, padding: '5px 12px',
                  ...(depositShares.length === 3
                    && depositShares[0]?.percent === 70
                    && depositShares[1]?.percent === 20
                    && depositShares[2]?.percent === 10
                    ? { background: 'rgba(0,212,255,0.15)', boxShadow: '0 0 8px rgba(0,212,255,0.3)' } : {}),
                }}
                onClick={() => setDepositShares([
                  { place: 1, percent: 70 },
                  { place: 2, percent: 20 },
                  { place: 3, percent: 10 },
                ])}
              >
                TOP 3 (70/20/10)
              </button>
            </div>
            {/* Share rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {depositShares.map((share, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: 8,
                    color: share.place === 1 ? '#FFD700' : share.place === 2 ? '#C0C0C0' : '#CD7F32',
                    minWidth: 30, textAlign: 'center',
                  }}>
                    {share.place === 1 ? '🥇' : share.place === 2 ? '🥈' : '🥉'} {share.place}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={share.percent}
                    onChange={e => {
                      const next = [...depositShares];
                      next[idx] = { ...share, percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) };
                      setDepositShares(next);
                    }}
                    style={{ ...inputStyle, width: 80, flex: 'none', textAlign: 'center' }}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-dim)' }}>%</span>
                  {depositShares.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDepositShares(depositShares.filter((_, i) => i !== idx))}
                      style={{
                        background: 'none', border: 'none', color: 'var(--color-red)',
                        cursor: 'pointer', fontSize: 14, padding: '4px 8px', lineHeight: 1,
                      }}
                      title="Remove place"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {depositShares.length < 3 && (
                <button
                  type="button"
                  className="btn btn-blue"
                  style={{ fontSize: 8, padding: '6px 14px', alignSelf: 'flex-start' }}
                  onClick={() => {
                    const nextPlace = (depositShares.length + 1) as 1 | 2 | 3;
                    setDepositShares([...depositShares, { place: nextPlace, percent: 0 }]);
                  }}
                >
                  + ADD PLACE
                </button>
              )}
            </div>
            {/* Validation: sum must equal 100 */}
            {(() => {
              const sum = depositShares.reduce((s, sh) => s + sh.percent, 0);
              return sum !== 100 ? (
                <div style={{
                  marginTop: 6, padding: '4px 10px', borderRadius: 4, fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(255,59,59,0.08)',
                  border: '1px solid rgba(255,59,59,0.3)',
                  color: 'var(--color-red)',
                }}>
                  ⚠ Percentages sum to {sum}% — must equal 100%
                </div>
              ) : null;
            })()}
          </div>

          <button
            className="btn btn-solid-orange"
            style={{ fontSize: 9, alignSelf: 'flex-start', padding: '10px 24px' }}
            onClick={handleDeposit}
            disabled={depositing || !depositPeriodKey || !depositToken || !depositSymbol || !depositAmount || depositShares.reduce((s, sh) => s + sh.percent, 0) !== 100}
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
                      {['SLOT', 'SYMBOL', 'TOKEN', 'AMOUNT', 'SPLIT', 'LINKS', 'TX HASH', 'DATE'].map(h => (
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
                          {formatTokens(b.amount, b.decimals ?? 8)}
                        </td>
                        <td style={{ padding: '6px', color: 'var(--color-blue)', fontFamily: 'var(--font-pixel)', fontSize: 7 }}>
                          {(b.prizeShares && b.prizeShares.length > 0)
                            ? b.prizeShares.map(s => `#${s.place}:${s.percent}%`).join(' ')
                            : '#1:100%'}
                        </td>
                        <td style={{ padding: '6px' }}>
                          {b.links && b.links.length > 0
                            ? <SponsorIcons links={b.links} size={12} />
                            : <span style={{ color: 'var(--color-text-dim)' }}>—</span>}
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

    </div>
  );
}
