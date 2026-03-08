import { useState, useEffect, useCallback } from 'react';
import { getTournaments } from '../api/http';

/**
 * Shared hook that polls the current OPNet block height every 30 seconds.
 * Used by TopBar and any component that needs up-to-date block info.
 */
export function useBlockHeight() {
  const [blockHeight, setBlockHeight] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getTournaments()
      .then((r) => {
        if (r.currentBlock) setBlockHeight(r.currentBlock);
      })
      .catch(() => { /* silent */ });
  }, []);

  useEffect(() => {
    refresh(); // initial fetch
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return blockHeight;
}
