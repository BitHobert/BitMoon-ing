/**
 * deploy-token.ts — Deploy tBTC OP-20 token to OPNet testnet.
 *
 * Usage:
 *   MNEMONIC="..." npm run deploy:token
 *
 * Output: ENTRY_TOKEN_ADDRESS to paste into bitmoon-backend/.env
 */

import {
    Mnemonic,
    TransactionFactory,
    MLDSASecurityLevel,
    AddressTypes,
    type IDeploymentParameters,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────

const NETWORK = networks.opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

const phrase = process.env['MNEMONIC'] ?? '';
if (!phrase.trim()) {
    console.error('Error: MNEMONIC env var is required.');
    process.exit(1);
}

// ── Wallet ────────────────────────────────────────────────────────────────────

const mnemonic = new Mnemonic(phrase.trim(), '', NETWORK, MLDSASecurityLevel.LEVEL2);
const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
console.log(`\nDeploying tBTC token from: ${wallet.p2tr}`);

// ── Provider & factory ────────────────────────────────────────────────────────

const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });
const factory = new TransactionFactory();

// ── Load WASM ─────────────────────────────────────────────────────────────────

const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../build/MyToken.wasm',
);
if (!fs.existsSync(wasmPath)) {
    console.error(`WASM not found at ${wasmPath} — run \`npm run build:token\` first.`);
    process.exit(1);
}
const bytecode = fs.readFileSync(wasmPath);
console.log(`WASM loaded: ${bytecode.length} bytes`);

// ── UTXOs ─────────────────────────────────────────────────────────────────────

console.log('\nFetching UTXOs...');
const utxos = await provider.utxoManager.getUTXOs({
    address: wallet.p2tr,
    optimize: false,
});
if (utxos.length === 0) {
    console.error(`No UTXOs found for ${wallet.p2tr}`);
    console.error('Fund this address with testnet BTC, then retry.');
    process.exit(1);
}
console.log(`Found ${utxos.length} UTXO(s).`);

// ── Challenge ─────────────────────────────────────────────────────────────────

console.log('Fetching challenge...');
const challenge = await provider.getChallenge();

// ── Sign & deploy ─────────────────────────────────────────────────────────────

console.log('Signing deployment...');
const deploymentParams: IDeploymentParameters = {
    from:                        wallet.p2tr,
    utxos,
    signer:                      wallet.keypair,
    mldsaSigner:                 wallet.mldsaKeypair,
    network:                     NETWORK,
    feeRate:                     5,
    priorityFee:                 0n,
    gasSatFee:                   10_000n,
    bytecode,
    calldata:                    new Uint8Array(0),
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey:        true,
};

const deployment = await factory.signDeployment(deploymentParams);
console.log(`\ntBTC Token address: ${deployment.contractAddress}`);

// ── Broadcast ─────────────────────────────────────────────────────────────────

console.log('Broadcasting funding transaction...');
const r1 = await provider.sendRawTransaction(deployment.transaction[0]);
console.log(`Funding TX ID : ${r1.result}`);

console.log('Broadcasting deploy transaction...');
const r2 = await provider.sendRawTransaction(deployment.transaction[1]);
console.log(`Deploy  TX ID : ${r2.result}`);

// ── Output ────────────────────────────────────────────────────────────────────

console.log('\n=== Add this to bitmoon-backend/.env ===\n');
console.log(`ENTRY_TOKEN_ADDRESS=${deployment.contractAddress}`);
console.log(`\nVerify at: https://testnet.opnet.org/tx/${r2.result}`);

if (typeof mnemonic.zeroize === 'function') mnemonic.zeroize();
if (typeof wallet.zeroize === 'function') wallet.zeroize();
