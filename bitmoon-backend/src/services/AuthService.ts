import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AddressVerificator, MessageSigner } from '@btc-vision/transaction';
import { payments } from '@btc-vision/bitcoin';
import { Config } from '../config/Config.js';

/**
 * Handles OP_WALLET / Unisat authentication.
 *
 * Flow:
 *  1. Client requests a nonce  →  server returns a time-stamped challenge string
 *  2. Client signs the challenge with their wallet private key
 *  3. Server verifies the signature against the player's public key & address
 *  4. On success, server issues a short-lived HMAC session token
 *
 * Supports two wallet signing formats:
 *  - OP_WALLET  (raw 64-byte Schnorr via MessageSigner.signMessageAuto)
 *  - Unisat     (BIP-322 simple — witness-encoded Schnorr)
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
     * Returns the message the client must sign with their wallet.
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
     * @param playerAddress  P2TR address claiming ownership
     * @param message        The exact challenge string that was signed
     * @param signature      Base64-encoded signature (raw Schnorr or BIP-322 witness)
     * @param publicKey      Hex-encoded compressed public key (33 bytes) — optional in DEV_MODE
     */
    public verifySignature(
        playerAddress: string,
        message: string,
        signature: string,
        publicKey?: string,
    ): boolean {
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

        // ── DEV_MODE bypass ────────────────────────────────────────────────
        if (Config.DEV_MODE) {
            console.warn('[AuthService] DEV_MODE: signature check is bypassed!');
            this.nonces.delete(playerAddress);
            return signature.length > 0;
        }

        // ── Production: real cryptographic verification ────────────────────
        if (!publicKey) {
            console.warn('[AuthService] No publicKey provided — cannot verify signature');
            this.nonces.delete(playerAddress);
            return false;
        }

        try {
            const pubKeyBytes = Buffer.from(publicKey, 'hex');
            const sigBytes = Buffer.from(signature, 'base64');

            // Verify public key corresponds to the claimed P2TR address
            if (!this.verifyPublicKeyMatchesAddress(pubKeyBytes, playerAddress)) {
                console.warn('[AuthService] publicKey does not match playerAddress');
                this.nonces.delete(playerAddress);
                return false;
            }

            // Extract raw 64-byte Schnorr signature (handles BIP-322 witness encoding)
            const rawSig = this.extractRawSignature(sigBytes);
            if (!rawSig) {
                console.warn('[AuthService] Could not extract Schnorr signature from payload');
                this.nonces.delete(playerAddress);
                return false;
            }

            // Consume the nonce before crypto work (prevent replay)
            this.nonces.delete(playerAddress);

            // Strategy 1: Untweaked verification (OP_WALLET signMessageAuto)
            try {
                if (MessageSigner.verifySignature(pubKeyBytes, message, rawSig)) {
                    return true;
                }
            } catch { /* fall through */ }

            // Strategy 2: Tweaked verification (wallets that sign with the tweaked key)
            try {
                if (MessageSigner.tweakAndVerifySignature(pubKeyBytes, message, rawSig)) {
                    return true;
                }
            } catch { /* fall through */ }

            console.warn('[AuthService] Signature verification failed (both strategies)');
            return false;
        } catch (err) {
            console.error('[AuthService] Verification error:', err);
            this.nonces.delete(playerAddress);
            return false;
        }
    }

    // ── Session Tokens ──────────────────────────────────────────────────────

    /**
     * Issue a signed session token for an authenticated player.
     * Token format: base64url(payload).hmac
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

    // ── Signature Helpers ────────────────────────────────────────────────────

    /**
     * Verify that a compressed public key derives the expected P2TR address.
     * Prevents an attacker from submitting a valid sig with a key that doesn't
     * correspond to the address they claim to own.
     */
    private verifyPublicKeyMatchesAddress(pubKeyBytes: Uint8Array, address: string): boolean {
        try {
            const network = Config.NETWORK;

            // Extract x-only key (drop prefix byte from 33-byte compressed pubkey)
            const xOnly = pubKeyBytes.length === 33
                ? pubKeyBytes.subarray(1)
                : pubKeyBytes;

            if (xOnly.length !== 32) return false;

            const p2tr = payments.p2tr({
                internalPubkey: xOnly as unknown as import('@btc-vision/bitcoin').XOnlyPublicKey,
                network,
            });
            return p2tr.address === address;
        } catch {
            return false;
        }
    }

    /**
     * Extract the raw 64-byte Schnorr signature from either:
     *  - A raw 64-byte buffer (OP_WALLET)
     *  - A BIP-322 simple witness for P2TR (Unisat): 0x01 0x40 [64 bytes]
     *  - A BIP-322 simple witness with sighash byte: 0x01 0x41 [65 bytes]
     */
    private extractRawSignature(sigBytes: Uint8Array): Uint8Array | null {
        // Raw Schnorr: exactly 64 bytes
        if (sigBytes.length === 64) {
            return sigBytes;
        }

        // BIP-322 simple P2TR witness: 0x01 (1 item) 0x40 (64 bytes) [sig]
        if (sigBytes.length === 66 && sigBytes[0] === 0x01 && sigBytes[1] === 0x40) {
            return sigBytes.subarray(2, 66);
        }

        // BIP-322 simple P2TR witness with sighash type: 0x01 0x41 (65 bytes) [sig + sighash]
        if (sigBytes.length === 67 && sigBytes[0] === 0x01 && sigBytes[1] === 0x41) {
            return sigBytes.subarray(2, 66);
        }

        return null;
    }

    // ── General Helpers ──────────────────────────────────────────────────────

    private buildChallengeMessage(address: string, nonce: string): string {
        return `Sign to play BitMoon'ing\nAddress: ${address}\nNonce: ${nonce}`;
    }

    private secureNonce(): string {
        return randomBytes(16).toString('hex');
    }

    private hmacSign(data: string): string {
        return createHmac('sha256', Config.JWT_SECRET).update(data).digest('base64url');
    }

    private validateAddress(address: string): void {
        const network = Config.NETWORK;
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
