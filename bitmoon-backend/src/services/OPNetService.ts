import { JSONRpcProvider } from 'opnet';
import { Config } from '../config/Config.js';

/**
 * Thin OPNet service kept for future use (e.g. on-chain verification).
 *
 * During gameplay the supply is tracked in MongoDB via GameSupplyService —
 * no contract calls are made here. This class exists only to hold a
 * configured provider instance ready for when mainnet integration is added.
 */
export class OPNetService {
    private static instance: OPNetService;

    private readonly provider: JSONRpcProvider;

    private constructor() {
        this.provider = new JSONRpcProvider({
            url: Config.OPNET_RPC_URL,
            network: Config.NETWORK,
        });
    }

    public static getInstance(): OPNetService {
        if (!OPNetService.instance) {
            OPNetService.instance = new OPNetService();
        }
        return OPNetService.instance;
    }

    /** Get the underlying provider (for future on-chain features). */
    public getProvider(): JSONRpcProvider {
        return this.provider;
    }
}
