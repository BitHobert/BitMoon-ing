import { JSONRpcProvider } from 'opnet';
import { OPNetLimitedProvider } from '@btc-vision/transaction';
import { Config } from '../config/Config.js';

/**
 * Centralised OPNet provider singleton.
 *
 * Caches both the full JSONRpcProvider (used for contract calls, block queries)
 * and the lightweight OPNetLimitedProvider (used for UTXO fetching & broadcast).
 * All services should obtain providers from here — never instantiate directly.
 */
export class OPNetService {
    private static instance: OPNetService;

    private readonly provider: JSONRpcProvider;
    private readonly limitedProvider: OPNetLimitedProvider;

    private constructor() {
        this.provider = new JSONRpcProvider({
            url: Config.OPNET_RPC_URL,
            network: Config.NETWORK,
        });

        this.limitedProvider = new OPNetLimitedProvider(Config.OPNET_RPC_URL);
    }

    public static getInstance(): OPNetService {
        if (!OPNetService.instance) {
            OPNetService.instance = new OPNetService();
        }
        return OPNetService.instance;
    }

    /** Full JSON-RPC provider for contract calls, block queries, address resolution. */
    public getProvider(): JSONRpcProvider {
        return this.provider;
    }

    /** Lightweight provider for UTXO fetching and transaction broadcasting. */
    public getLimitedProvider(): OPNetLimitedProvider {
        return this.limitedProvider;
    }
}
