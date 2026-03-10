/**
 * Network configuration — driven by VITE_NETWORK env var.
 *
 * Build-time:  VITE_NETWORK=testnet | mainnet  (defaults to testnet)
 *
 * Each network profile includes API/WS endpoints and display metadata.
 * Contract addresses are NOT stored here — they come from the backend API.
 */

export type NetworkId = 'testnet' | 'mainnet';

export interface NetworkConfig {
  /** Network identifier */
  id: NetworkId;
  /** Human-readable label for UI */
  label: string;
  /** Short badge text */
  badge: string;
  /** Badge color */
  color: string;
  /** REST API base URL (no trailing slash) */
  apiBase: string;
  /** WebSocket URL */
  wsUrl: string;
  /** OPNet RPC URL (for any direct RPC calls) */
  rpcUrl: string;
  /** Token symbol used for entry fees */
  tokenSymbol: string;
  /** Block explorer base URL (if available) */
  explorerUrl: string | null;
}

const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: 'testnet',
    label: 'OPNet Testnet',
    badge: 'TESTNET',
    color: '#ffa500',
    apiBase: import.meta.env['VITE_API_BASE_URL'] as string ?? '/api',
    wsUrl:
      (import.meta.env['VITE_WS_URL'] as string | undefined) ??
      (import.meta.env.DEV ? 'ws://localhost:3001' : `wss://${window.location.host}/ws`),
    rpcUrl: 'https://testnet.opnet.org',
    tokenSymbol: 'LFGT',
    explorerUrl: null,
  },
  mainnet: {
    id: 'mainnet',
    label: 'OPNet Mainnet',
    badge: 'MAINNET',
    color: '#39ff14',
    apiBase: import.meta.env['VITE_API_BASE_URL_MAINNET'] as string ?? '/api',
    wsUrl:
      (import.meta.env['VITE_WS_URL_MAINNET'] as string | undefined) ??
      (import.meta.env.DEV ? 'ws://localhost:3001' : `wss://${window.location.host}/ws`),
    rpcUrl: 'https://node1.opnet.org',
    tokenSymbol: 'LFGT',
    explorerUrl: null,
  },
};

/** Current network — resolved once at build time from VITE_NETWORK */
const envNetwork = (import.meta.env['VITE_NETWORK'] as string | undefined) ?? 'testnet';
const resolvedId: NetworkId = envNetwork === 'mainnet' ? 'mainnet' : 'testnet';

export const NETWORK: NetworkConfig = NETWORKS[resolvedId];
export const NETWORK_ID: NetworkId = resolvedId;
export const IS_MAINNET: boolean = resolvedId === 'mainnet';
export const IS_TESTNET: boolean = resolvedId === 'testnet';

/** Get config for a specific network (useful for admin tools) */
export function getNetworkConfig(id: NetworkId): NetworkConfig {
  return NETWORKS[id];
}
