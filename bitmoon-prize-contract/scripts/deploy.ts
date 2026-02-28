/**
 * deploy.ts — Deploy PrizeDistributor.wasm to OPNet testnet.
 *
 * Usage:
 *   MNEMONIC="..." \
 *   ENTRY_TOKEN_ADDRESS=<tBTC_OP20_contract> \
 *   DEV_WALLET=opt1ptz9xq6xsxed58jxu48e69a2fmhkks5hkzx8hhpcc8g7cx9asphus725zs7 \
 *   npm run deploy
 *
 * Output: PRIZE_CONTRACT_ADDRESS to paste into bitmoon-backend/.env
 *
 * Prerequisites:
 *   1. Run `npm run keygen` and copy OPERATOR_* values into bitmoon-backend/.env
 *   2. Fund the operator P2TR address with testnet BTC
 *   3. Know the tBTC OP-20 contract address on OPNet testnet
 */

import {
    Mnemonic,
    TransactionFactory,
    BinaryWriter,
    Address,
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

const phrase      = process.env['MNEMONIC']            ?? '';
const tbtcAddress = process.env['ENTRY_TOKEN_ADDRESS'] ?? '';
const devWallet   = process.env['DEV_WALLET']          ?? 'opt1ptz9xq6xsxed58jxu48e69a2fmhkks5hkzx8hhpcc8g7cx9asphus725zs7';

if (!phrase.trim()) {
    console.error('Error: MNEMONIC env var is required.');
    process.exit(1);
}
if (!tbtcAddress.trim()) {
    console.error('Error: ENTRY_TOKEN_ADDRESS env var is required (tBTC OP-20 contract on testnet).');
    process.exit(1);
}

// ── Wallet ────────────────────────────────────────────────────────────────────

const mnemonic = new Mnemonic(phrase.trim(), '', NETWORK, MLDSASecurityLevel.LEVEL2);
const wallet   = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
console.log(`\nDeploying from: ${wallet.p2tr}`);

// ── Provider & factory ────────────────────────────────────────────────────────

const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });
const factory  = new TransactionFactory();

// ── Constructor calldata ──────────────────────────────────────────────────────
//
// PrizeDistributor.onDeployment reads:
//   calldata.readAddress()  → tokenAddress (Address — MLDSA key hash)
//   calldata.readAddress()  → devWallet    (Address — MLDSA key hash)
//
// Address.fromString() requires hex public keys — bech32 addresses must be
// resolved via getPublicKeyInfo().

console.log('\nResolving calldata addresses...');
const tokenAddr = await provider.getPublicKeyInfo(tbtcAddress.trim(), true);
// For the dev wallet, use wallet.address directly (same as getPublicKeyInfo would return)
const devAddr   = devWallet.trim() === wallet.p2tr
    ? wallet.address
    : await provider.getPublicKeyInfo(devWallet.trim(), false);

const writer = new BinaryWriter();
writer.writeAddress(tokenAddr);
writer.writeAddress(devAddr);
const calldata = writer.getBuffer();
console.log(`Token address : ${tbtcAddress} → ${tokenAddr.toHex()}`);
console.log(`Dev wallet    : ${devWallet} → ${devAddr.toHex()}`);
console.log(`Calldata size : ${calldata.length} bytes`);

// ── Load WASM ─────────────────────────────────────────────────────────────────

const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../build/PrizeDistributor.wasm',
);
if (!fs.existsSync(wasmPath)) {
    console.error(`WASM not found at ${wasmPath} — run \`npm run build\` first.`);
    process.exit(1);
}
const bytecode = fs.readFileSync(wasmPath);
console.log(`WASM loaded   : ${bytecode.length} bytes`);

// ── UTXOs ─────────────────────────────────────────────────────────────────────

console.log('\nFetching UTXOs...');
const utxos = await provider.utxoManager.getUTXOs({ address: wallet.p2tr });
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
    calldata,
    challenge,
    linkMLDSAPublicKeyToAddress: true,
    revealMLDSAPublicKey:        true,
};

const deployment = await factory.signDeployment(deploymentParams);
console.log(`\nContract address : ${deployment.contractAddress}`);

// ── Broadcast ─────────────────────────────────────────────────────────────────

console.log('Broadcasting funding transaction...');
const r1 = await provider.sendRawTransaction(deployment.transaction[0]);
console.log(`Funding TX ID    : ${r1.result}`);

console.log('Broadcasting deploy transaction...');
const r2 = await provider.sendRawTransaction(deployment.transaction[1]);
console.log(`Deploy  TX ID    : ${r2.result}`);

// ── Output ────────────────────────────────────────────────────────────────────

console.log('\n=== Add these to bitmoon-backend/.env ===\n');
console.log(`PRIZE_CONTRACT_ADDRESS=${deployment.contractAddress}`);
console.log(`ENTRY_TOKEN_ADDRESS=${tbtcAddress.trim()}`);
console.log(`\nVerify at: https://testnet.opnet.org/tx/${r2.result}`);

if (typeof mnemonic.zeroize === 'function') mnemonic.zeroize();
if (typeof wallet.zeroize === 'function') wallet.zeroize();
