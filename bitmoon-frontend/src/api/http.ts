import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  PlayerStats,
  PrizeDistribution,
  ScoreResult,
  SessionEndRequest,
  SessionStartRequest,
  SessionStartResponse,
  SupplySnapshot,
  TournamentEnterRequest,
  TournamentEnterResponse,
  TournamentInfo,
  TournamentType,
} from '../types';

const BASE = '/api';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json() as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ── Public routes ─────────────────────────────────────────────────────────────

export function getSupply(): Promise<SupplySnapshot> {
  return request('/v1/supply');
}

export function getNonce(address: string): Promise<{ message: string }> {
  return request(`/v1/nonce/${encodeURIComponent(address)}`);
}

export function startSession(body: SessionStartRequest): Promise<SessionStartResponse> {
  return request('/v1/session/start', { method: 'POST', body: JSON.stringify(body) });
}

export function endSession(token: string, body: SessionEndRequest): Promise<ScoreResult> {
  return request('/v1/session/end', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function getLeaderboard(
  period: LeaderboardPeriod,
  limit = 100,
): Promise<{ period: string; type: string; entries: LeaderboardEntry[] }> {
  return request(`/v1/leaderboard/${period}?limit=${limit}`);
}

export function getPlayer(address: string): Promise<PlayerStats> {
  return request(`/v1/player/${encodeURIComponent(address)}`);
}

export function getTournaments(): Promise<{ tournaments: TournamentInfo[] }> {
  return request('/v1/tournaments');
}

export function getTournamentLeaderboard(
  type: TournamentType,
  limit = 100,
): Promise<{ tournamentType: TournamentType; tournamentKey: string; entries: LeaderboardEntry[] }> {
  return request(`/v1/tournament/${type}/leaderboard?limit=${limit}`);
}

export function getTournamentWinners(
  type: TournamentType,
): Promise<{ tournamentType: string; distribution: PrizeDistribution | null }> {
  return request(`/v1/tournament/${type}/winners`);
}

// ── Authenticated routes ──────────────────────────────────────────────────────

export function enterTournament(
  token: string,
  body: TournamentEnterRequest,
): Promise<TournamentEnterResponse> {
  return request('/v1/tournament/enter', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export { ApiError };
