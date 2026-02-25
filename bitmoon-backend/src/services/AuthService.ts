import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AddressVerificator } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { Config } from '../config/Config.js';

/**
 * Handles OP_WALLET authentication.
 *
 * Flow:
 *  1. Client requests a nonce  →  server returns a time-stamped challenge string
 *  2. Client signs the challenge with their OP_WALLET private key
 *  3. Server verifies the signature against the player's address
 *  4. On success, server issues a short-lived JWT-style session token
 *
 * Note: Full ECDSA / Schnorr signature verification is delegated to
 * @btc-vision/transaction's AddressVerificator once the method is exposed.
 * Until then, we use a signed-nonce pattern with HMAC for integrity.
 */
export class AuthService {
    private static instance: AuthService;

    /** In-memory nonce store: address → { nonce, expiresAt } */
    private readonly nonces: Map<string, { nonce: string; expiresAt: number }> = new Map();

    /** Nonce TTL: 5 minutes */
    private static readonly NONCE_TTL_MS = 5 * 60 * 1000;

    private constructor() {
        // Prune expired nonces every 5 minutes
        setInterval(() => { this.pruneNonces(); }, 5 * 60 * 1000);
    }

    public static getInstance(): AuthService {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService();
        }
        return AuthService.instance;
    }

    // ── Nonce ───────────────────────────────────────────────────────────────

    /**
     * Generate and store a challenge nonce for the given player address.
     * Returns the message the client must sign with OP_WALLET.
     */
    public generateChallenge(playerAddress: string): string {
        this.validateAddress(playerAddress);

        const nonce = this.secureNonce();
        const expiresAt = Date.now() + AuthService.NONCE_TTL_MS;
        this.nonces.set(playerAddress, { nonce, expiresAt });

        return this.buildChallengeMessage(playerAddress, nonce);
    }

    /**
     * Verify a wallet signature against a previously issued challenge.
     *
     * Returns true if valid, false otherwise.
     *
     * IMPORTANT: Replace the stub verification below with a proper
     * Schnorr / ECDSA check once the btc-vision SDK exposes it.
     */
    public verifySignature(playerAddress: string, message: string, signature: string): boolean {
        this.validateAddress(playerAddress);

        const stored = this.nonces.get(playerAddress);
        if (!stored) return false;
        if (Date.now() > stored.expiresAt) {
            this.nonces.delete(playerAddress);
            return false;
        }

        // Verify the message matches the expected challenge
        const expected = this.buildChallengeMessage(playerAddress, stored.nonce);
        if (message !== expected) return false;

        // ── Signature verification ────────────────────────────────────────
        // TODO: Replace stub with real Schnorr verification once
        //       @btc-vision/transaction exposes verifyMessage().
        //
        // Stub: accept any non-empty signature in DEV_MODE.
        // In production this MUST be replaced.
        if (Config.DEV_MODE) {
            console.warn('[AuthService] DEV_MODE: signature check is bypassed!');
            this.nonces.delete(playerAddress);
            return signature.length > 0;
        }

        // Production path (to be wired up):
        // return AddressVerificator.verifySignature(playerAddress, message, signature, network);
        void AddressVerificator; // suppress unused import warning until wired up
        this.nonces.delete(playerAddress);
        return false; // Fail closed until real verification is wired
    }

    // ── Session Tokens ──────────────────────────────────────────────────────

    /**
     * Issue a signed session token for an authenticated player.
     * Token format: base64url(header.payload.hmac)
     */
    public issueSessionToken(playerAddress: string, sessionId: string): string {
        const payload = JSON.stringify({
            sub: playerAddress,
            sid: sessionId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor((Date.now() + Config.SESSION_TTL_MS) / 1000),
        });

        const encoded = Buffer.from(payload).toString('base64url');
        const sig = this.hmacSign(encoded);
        return `${encoded}.${sig}`;
    }

    /**
     * Verify a session token and return the payload, or null if invalid.
     */
    public verifySessionToken(token: string): { sub: string; sid: string; exp: number } | null {
        const parts = token.split('.');
        if (parts.length !== 2) return null;

        const [encoded, sig] = parts as [string, string];
        const expectedSig = this.hmacSign(encoded);

        // Constant-time comparison to prevent timing attacks
        try {
            const sigBuf = Buffer.from(sig, 'base64url');
            const expBuf = Buffer.from(expectedSig, 'base64url');
            if (sigBuf.length !== expBuf.length) return null;
            if (!timingSafeEqual(sigBuf, expBuf)) return null;
        } catch {
            return null;
        }

        try {
            const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
                sub: string;
                sid: string;
                exp: number;
            };
            if (Date.now() / 1000 > payload.exp) return null;
            return payload;
        } catch {
            return null;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private buildChallengeMessage(address: string, nonce: string): string {
        return `Sign to play BitMoon'ing\nAddress: ${address}\nNonce: ${nonce}`;
    }

    private secureNonce(): string {
        return createHash('sha256')
            .update(Math.random().toString() + Date.now().toString())
            .digest('hex')
            .slice(0, 32);
    }

    private hmacSign(data: string): string {
        return createHmac('sha256', Config.JWT_SECRET).update(data).digest('base64url');
    }

    private validateAddress(address: string): void {
        const network = Config.OPNET_NETWORK === 'mainnet' ? networks.bitcoin : networks.testnet;
        const addrType = AddressVerificator.detectAddressType(address, network);
        if (addrType === null) {
            throw new Error(`Invalid player address: ${address}`);
        }
    }

    private pruneNonces(): void {
        const now = Date.now();
        for (const [addr, entry] of this.nonces) {
            if (now > entry.expiresAt) this.nonces.delete(addr);
        }
    }
}
