/**
 * keygen.ts — Derive BitMoon operator wallet keys from a BIP-39 mnemonic.
 *
 * Usage:
 *   MNEMONIC="word1 word2 ... word24" npm run keygen
 *
 * Output: the three OPERATOR_* lines to paste into bitmoon-backend/.env
 */

import { Mnemonic, MLDSASecurityLevel } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const phrase = process.env['MNEMONIC'] ?? '';
if (!phrase.trim()) {
    console.error('Error: MNEMONIC env var is required.');
    console.error('Usage: MNEMONIC="word1 word2 ... word24" npm run keygen');
    process.exit(1);
}

const mnemonic = new Mnemonic(phrase.trim(), '', networks.testnet, MLDSASecurityLevel.LEVEL2);
const wallet   = mnemonic.derive(0);

console.log('\n=== BitMoon Operator Keys (TESTNET — keep secret!) ===\n');
console.log(`OPERATOR_P2TR_ADDRESS=${wallet.p2tr}`);
console.log(`OPERATOR_PRIVATE_KEY=${wallet.toWIF()}`);
console.log(`OPERATOR_MLDSA_KEY=${wallet.toQuantumBase58()}`);
console.log('\n--- Copy the 3 lines above into bitmoon-backend/.env ---\n');
console.log('Fund this address with testnet BTC before running deploy:');
console.log(wallet.p2tr);

mnemonic.zeroize();
wallet.zeroize();
