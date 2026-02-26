# BitMoon — Prize Contract

> OPNet smart contract for BitMoon tournament prize distribution on Bitcoin.

---

## What it does

The prize contract holds tournament prize pools and distributes winnings to verified winners. It is called by the BitMoon backend after each tournament closes.

- Accepts OP-20 token deposits as prize pool funding
- Stores winner addresses and allocations set by the authorised backend
- Distributes prizes to winners on-chain in a single transaction
- Immutable prize records — once winners are set they cannot be altered

---

## Stack

| Layer | Technology |
|-------|-----------|
| Language | AssemblyScript |
| Runtime | OPNet BTC-Runtime |
| Compiled target | WebAssembly |
| Chain | OPNet / Bitcoin |

---

## Getting Started

```bash
# Install dependencies
npm install

# Compile contract to WASM (release build)
npm run build
```

The compiled `.wasm` output is written to `build/`.

---

## Deployment

Deploy via the OPNet CLI:

```bash
# Generate a quantum-resistant MLDSA keypair (first time only)
opnet keygen

# Compile
npm run build

# Deploy to testnet
opnet deploy --network testnet --wasm build/contract.wasm

# Deploy to mainnet
opnet deploy --network mainnet --wasm build/contract.wasm
```

---

## Project Structure

```
src/
├── index.ts              — contract entry point
└── contracts/            — contract logic
abis/                     — generated ABI files
build/                    — compiled WASM output
```

---

## Related Repositories

- [bitmoon-frontend](../bitmoon-frontend) — React/Canvas browser game
- [bitmoon-backend](../bitmoon-backend) — API server, score validation, leaderboards
