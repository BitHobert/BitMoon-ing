import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WsClient } from '../api/ws';
import type { KillFeedEntry, SupplySnapshot } from '../types';

const INITIAL_SUPPLY = 100_000_000_000_000_000n; // 10^17 raw units (1B tokens × 10^8)
const WS_URL: string =
  (import.meta.env['VITE_WS_URL'] as string | undefined) ??
  (import.meta.env.DEV ? 'ws://localhost:3001' : `wss://${window.location.host}/ws`);

interface WsContextValue {
  supply: SupplySnapshot | null;
  latestKills: KillFeedEntry[];
  connected: boolean;
}

const WsContext = createContext<WsContextValue>({
  supply: null,
  latestKills: [],
  connected: false,
});

const MAX_KILL_FEED = 10;

export function WsProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<WsClient | null>(null);
  const [supply, setSupply] = useState<SupplySnapshot | null>(null);
  const [latestKills, setLatestKills] = useState<KillFeedEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const client = new WsClient(WS_URL);
    clientRef.current = client;

    client.subscribe('supply_update', (data) => {
      setSupply(data);
      setConnected(true);
    });

    client.subscribe('kill_feed', (data) => {
      setLatestKills((prev) => [data, ...prev].slice(0, MAX_KILL_FEED));
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  return (
    <WsContext.Provider value={{ supply, latestKills, connected }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWsContext(): WsContextValue {
  return useContext(WsContext);
}

export { INITIAL_SUPPLY };
