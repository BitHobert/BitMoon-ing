import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    ADDRESS_BYTE_LENGTH,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    ReentrancyGuard,
    Revert,
    SafeMath,
    StoredAddress,
    StoredU256,
    TransferHelper,
} from '@btc-vision/btc-runtime/runtime';
import { EntryRecordedEvent } from './events/EntryRecordedEvent';
import { PrizeDistributedEvent } from './events/PrizeDistributedEvent';
import { SponsorBonusDepositedEvent } from './events/SponsorBonusDepositedEvent';
import { SponsorBonusDistributedEvent } from './events/SponsorBonusDistributedEvent';

// ── Storage pointers (allocated once at module load; order must never change) ──

const tokenAddressPointer: u16 = Blockchain.nextPointer;
const devWalletPointer:    u16 = Blockchain.nextPointer;
const operatorPointer:     u16 = Blockchain.nextPointer;

// mainPool[0..2] — accumulated 80 % per tournament type per period
const mainPool0Pointer: u16 = Blockchain.nextPointer;
const mainPool1Pointer: u16 = Blockchain.nextPointer;
const mainPool2Pointer: u16 = Blockchain.nextPointer;

// stagingCarry[0..2] — 15 % from CURRENT period; becomes activeCarry for NEXT period
const stagingCarry0Pointer: u16 = Blockchain.nextPointer;
const stagingCarry1Pointer: u16 = Blockchain.nextPointer;
const stagingCarry2Pointer: u16 = Blockchain.nextPointer;

// activeCarry[0..2] — 15 % carry from PREVIOUS period; added to current prize
const activeCarry0Pointer: u16 = Blockchain.nextPointer;
const activeCarry1Pointer: u16 = Blockchain.nextPointer;
const activeCarry2Pointer: u16 = Blockchain.nextPointer;

// lastDistributedKey[0..2] — periodKey of last completed distribution (prevents double-pay)
const lastDistKey0Pointer: u16 = Blockchain.nextPointer;
const lastDistKey1Pointer: u16 = Blockchain.nextPointer;
const lastDistKey2Pointer: u16 = Blockchain.nextPointer;

// devPool — global accumulated 5 % dev cuts
const devPoolPointer: u16 = Blockchain.nextPointer;

// ── Sponsor bonus storage pointers (appended; order must never change) ────────

// sponsorCount[type, periodKey] → u256 number of bonus slots for a period
const sponsorCountPointer:  u16 = Blockchain.nextPointer; // 16

// sponsorAmount[type, periodKey, slot] → u256 bonus amount at that slot
const sponsorAmountPointer: u16 = Blockchain.nextPointer; // 17

// sponsorToken[type, periodKey, slot]  → u256 (sponsor OP-20 token address, 20 bytes left-padded)
const sponsorTokenPointer:  u16 = Blockchain.nextPointer; // 18

// ── Helpers ───────────────────────────────────────────────────────────────────

function isZeroAddress(addr: Address): bool {
    for (let i: i32 = 0; i < addr.length; i++) {
        if (addr[i] !== 0) return false;
    }
    return true;
}

/**
 * Build a 30-byte sub-pointer key for the sponsor storage maps.
 *
 * Layout:
 *   byte  0:    tournamentType (u8)
 *   bytes 1–8:  low 8 bytes of periodKey (lo1 field, big-endian) — block nums fit in u64
 *   bytes 9–12: slotIndex (u32, big-endian); use COUNT_SENTINEL (0xFFFFFFFF) for count keys
 *   bytes 13–29: zero padding
 */
function makeSponsorKey(tournamentType: u8, periodKey: u256, slot: u32): Uint8Array {
    const key = new Uint8Array(30);
    key[0] = tournamentType;
    const lo1: u64 = periodKey.lo1;
    key[1] = u8((lo1 >> 56) & 0xFF);
    key[2] = u8((lo1 >> 48) & 0xFF);
    key[3] = u8((lo1 >> 40) & 0xFF);
    key[4] = u8((lo1 >> 32) & 0xFF);
    key[5] = u8((lo1 >> 24) & 0xFF);
    key[6] = u8((lo1 >> 16) & 0xFF);
    key[7] = u8((lo1 >>  8) & 0xFF);
    key[8] = u8( lo1        & 0xFF);
    key[9]  = u8((slot >> 24) & 0xFF);
    key[10] = u8((slot >> 16) & 0xFF);
    key[11] = u8((slot >>  8) & 0xFF);
    key[12] = u8( slot        & 0xFF);
    return key;
}

/** Sentinel slot value used for the count key (impossible as a real slot index). */
const COUNT_SENTINEL: u32 = 0xFFFFFFFF;

/**
 * Maximum sponsor bonus slots per (tournamentType, periodKey).
 * Caps the for-loop in _distributePrize to prevent Bitcoin witness-size overflow
 * (~100 KB relay limit). 50 slots × ~32 bytes calldata per slot ≈ 1.6 KB — well safe.
 */
const MAX_SPONSOR_SLOTS: u32 = 50;

/**
 * Encode a 20-byte Address into the low 20 bytes of a big-endian u256
 * (bytes 0-11 are zero, bytes 12-31 are the address).
 */
function addressToU256(addr: Address): u256 {
    const buf = new Uint8Array(32);
    for (let i: i32 = 0; i < ADDRESS_BYTE_LENGTH; i++) {
        buf[12 + i] = addr[i];
    }
    return u256.fromBytes(buf, true);
}

/**
 * Decode a u256 produced by addressToU256() back into an Address.
 * Extracts bytes 12-31 of the big-endian 32-byte representation.
 */
function u256ToAddress(val: u256): Address {
    const buf  = val.toBytes(true); // big-endian 32 bytes
    const addr = new Uint8Array(ADDRESS_BYTE_LENGTH);
    for (let i: i32 = 0; i < ADDRESS_BYTE_LENGTH; i++) {
        addr[i] = buf[12 + i];
    }
    return addr as Address;
}

// ── Contract ──────────────────────────────────────────────────────────────────

/**
 * PrizeDistributor — BitMoon tournament prize escrow contract.
 *
 * Players transfer the OP-20 entry token directly to this contract's address.
 * The backend operator calls recordEntry() after verifying each transfer.
 * At prizeBlock the backend calls distributePrize() for the winning addresses.
 *
 * Pool accounting:
 *  - mainPool[type]     += amount * 80 % (current period prize)
 *  - stagingCarry[type] += amount * 15 % (becomes NEXT period's activeCarry)
 *  - devPool            += amount * 5 %  (sent to devWallet at prize time)
 *
 * At distributePrize:
 *  prizeTotal = mainPool[type] + activeCarry[type]
 *  Split by number of valid (non-zero) winners:
 *    3 → 70 / 20 / 10 %
 *    2 → 80 / 20 %
 *    1 → 100 %
 *    0 → rollover (entire prizeTotal added to stagingCarry for next period)
 *  Rotate: activeCarry[type] = stagingCarry[type]; clear mainPool and stagingCarry.
 *  Dev cut: transfer devPool to devWallet; clear devPool.
 */
@final
export class PrizeDistributor extends ReentrancyGuard {

    // ── Storage fields ────────────────────────────────────────────────────────

    private readonly _tokenAddress:  StoredAddress;
    private readonly _devWallet:     StoredAddress;
    private readonly _operator:      StoredAddress;

    private readonly _mainPool0:     StoredU256;
    private readonly _mainPool1:     StoredU256;
    private readonly _mainPool2:     StoredU256;

    private readonly _stagingCarry0: StoredU256;
    private readonly _stagingCarry1: StoredU256;
    private readonly _stagingCarry2: StoredU256;

    private readonly _activeCarry0:  StoredU256;
    private readonly _activeCarry1:  StoredU256;
    private readonly _activeCarry2:  StoredU256;

    private readonly _lastDistKey0:  StoredU256;
    private readonly _lastDistKey1:  StoredU256;
    private readonly _lastDistKey2:  StoredU256;

    private readonly _devPool:       StoredU256;

    constructor() {
        super();
        this._tokenAddress  = new StoredAddress(tokenAddressPointer);
        this._devWallet     = new StoredAddress(devWalletPointer);
        this._operator      = new StoredAddress(operatorPointer);

        this._mainPool0     = new StoredU256(mainPool0Pointer,     EMPTY_POINTER);
        this._mainPool1     = new StoredU256(mainPool1Pointer,     EMPTY_POINTER);
        this._mainPool2     = new StoredU256(mainPool2Pointer,     EMPTY_POINTER);

        this._stagingCarry0 = new StoredU256(stagingCarry0Pointer, EMPTY_POINTER);
        this._stagingCarry1 = new StoredU256(stagingCarry1Pointer, EMPTY_POINTER);
        this._stagingCarry2 = new StoredU256(stagingCarry2Pointer, EMPTY_POINTER);

        this._activeCarry0  = new StoredU256(activeCarry0Pointer,  EMPTY_POINTER);
        this._activeCarry1  = new StoredU256(activeCarry1Pointer,  EMPTY_POINTER);
        this._activeCarry2  = new StoredU256(activeCarry2Pointer,  EMPTY_POINTER);

        this._lastDistKey0  = new StoredU256(lastDistKey0Pointer,  EMPTY_POINTER);
        this._lastDistKey1  = new StoredU256(lastDistKey1Pointer,  EMPTY_POINTER);
        this._lastDistKey2  = new StoredU256(lastDistKey2Pointer,  EMPTY_POINTER);

        this._devPool       = new StoredU256(devPoolPointer,       EMPTY_POINTER);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Called once at deployment.
     * Calldata layout: tokenAddress (20 bytes) | devWallet (20 bytes)
     */
    public override onDeployment(calldata: Calldata): void {
        const token  = calldata.readAddress();
        const dev    = calldata.readAddress();

        if (isZeroAddress(token)) throw new Revert('PrizeDistributor: zero token address');
        if (isZeroAddress(dev))   throw new Revert('PrizeDistributor: zero dev wallet');

        this._tokenAddress.value = token;
        this._devWallet.value    = dev;
        this._operator.value     = Blockchain.tx.sender;
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    private requireOperator(): void {
        if (Blockchain.tx.sender !== this._operator.value) {
            throw new Revert('PrizeDistributor: caller is not operator');
        }
    }

    private requireDeployer(): void {
        this.onlyDeployer(Blockchain.tx.sender);
    }

    // ── Pool accessors ────────────────────────────────────────────────────────

    private mainPool(type: u8): StoredU256 {
        if (type === 0) return this._mainPool0;
        if (type === 1) return this._mainPool1;
        return this._mainPool2;
    }

    private stagingCarry(type: u8): StoredU256 {
        if (type === 0) return this._stagingCarry0;
        if (type === 1) return this._stagingCarry1;
        return this._stagingCarry2;
    }

    private activeCarry(type: u8): StoredU256 {
        if (type === 0) return this._activeCarry0;
        if (type === 1) return this._activeCarry1;
        return this._activeCarry2;
    }

    private lastDistKey(type: u8): StoredU256 {
        if (type === 0) return this._lastDistKey0;
        if (type === 1) return this._lastDistKey1;
        return this._lastDistKey2;
    }

    // ── View methods (read-only) ────────────────────────────────────────────────

    /**
     * getPoolInfo(tournamentType: u8)
     * Returns (mainPool, stagingCarry, activeCarry, lastDistKey) for the given tournament type.
     */
    @method({ name: 'tournamentType', type: ABIDataTypes.UINT8 })
    @returns(
        { name: 'mainPool', type: ABIDataTypes.UINT256 },
        { name: 'stagingCarry', type: ABIDataTypes.UINT256 },
        { name: 'activeCarry', type: ABIDataTypes.UINT256 },
        { name: 'lastDistKey', type: ABIDataTypes.UINT256 },
    )
    public getPoolInfo(calldata: Calldata): BytesWriter {
        const tournamentType = calldata.readU8();
        if (tournamentType > 2) throw new Revert('PrizeDistributor: invalid tournament type');

        const writer = new BytesWriter(128); // 4 × 32 bytes
        writer.writeU256(this.mainPool(tournamentType).value);
        writer.writeU256(this.stagingCarry(tournamentType).value);
        writer.writeU256(this.activeCarry(tournamentType).value);
        writer.writeU256(this.lastDistKey(tournamentType).value);
        return writer;
    }

    /**
     * getOperator() — returns the current operator address.
     */
    @method()
    @returns({ name: 'operator', type: ABIDataTypes.ADDRESS })
    public getOperator(calldata: Calldata): BytesWriter {
        const writer = new BytesWriter(ADDRESS_BYTE_LENGTH);
        writer.writeAddress(this._operator.value);
        return writer;
    }

    /**
     * getTokenAddress() — returns the entry fee token contract address.
     */
    @method()
    @returns({ name: 'token', type: ABIDataTypes.ADDRESS })
    public getTokenAddress(calldata: Calldata): BytesWriter {
        const writer = new BytesWriter(ADDRESS_BYTE_LENGTH);
        writer.writeAddress(this._tokenAddress.value);
        return writer;
    }

    /**
     * getSponsorCount(tournamentType: u8, periodKey: u256)
     * Returns the number of sponsor bonus slots deposited for the given period.
     */
    @method(
        { name: 'tournamentType', type: ABIDataTypes.UINT8 },
        { name: 'periodKey', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'count', type: ABIDataTypes.UINT256 })
    public getSponsorCount(calldata: Calldata): BytesWriter {
        const tournamentType = calldata.readU8();
        const periodKey      = calldata.readU256();

        if (tournamentType > 2) throw new Revert('PrizeDistributor: invalid tournament type');

        const countKey = makeSponsorKey(tournamentType, periodKey, COUNT_SENTINEL);
        const count    = new StoredU256(sponsorCountPointer, countKey).value;

        const writer = new BytesWriter(32);
        writer.writeU256(count);
        return writer;
    }

    // ── Write methods ─────────────────────────────────────────────────────────────

    /**
     * recordEntry(tournamentType: u8, periodKey: u256, amount: u256)
     *
     * Called by the backend operator after verifying an on-chain token transfer
     * to this contract's address. Updates pool accounting only — does not move tokens.
     *
     * Fee split:
     *   mainPool[type]     += amount * 8000 / 10000  (80 %)
     *   stagingCarry[type] += amount * 1500 / 10000  (15 %)
     *   devPool            += amount - main - staging (5 %, remainder avoids rounding loss)
     */
    @method(
        { name: 'tournamentType', type: ABIDataTypes.UINT8 },
        { name: 'periodKey', type: ABIDataTypes.UINT256 },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public recordEntry(calldata: Calldata): BytesWriter {
        this.requireOperator();

        const tournamentType = calldata.readU8();
        const periodKey      = calldata.readU256();
        const amount         = calldata.readU256();

        if (tournamentType > 2) throw new Revert('PrizeDistributor: invalid tournament type');
        if (u256.eq(amount, u256.Zero)) throw new Revert('PrizeDistributor: zero amount');

        // periodKey must fit in u64 (block numbers do; sponsor key only encodes lo1)
        if (periodKey.lo2 !== 0 || periodKey.hi1 !== 0 || periodKey.hi2 !== 0) {
            throw new Revert('PrizeDistributor: periodKey exceeds u64');
        }

        // Guard: period must not be already closed
        if (u256.eq(this.lastDistKey(tournamentType).value, periodKey)) {
            throw new Revert('PrizeDistributor: period already distributed');
        }

        // Compute split
        const mainDelta    = SafeMath.div(SafeMath.mul(amount, u256.fromU32(8000)), u256.fromU32(10000));
        const stagingDelta = SafeMath.div(SafeMath.mul(amount, u256.fromU32(1500)), u256.fromU32(10000));
        const devDelta     = SafeMath.sub(SafeMath.sub(amount, mainDelta), stagingDelta);

        // Apply to storage
        const main    = this.mainPool(tournamentType);
        const staging = this.stagingCarry(tournamentType);

        main.value    = SafeMath.add(main.value,    mainDelta);
        staging.value = SafeMath.add(staging.value, stagingDelta);
        this._devPool.value = SafeMath.add(this._devPool.value, devDelta);

        this.emitEvent(new EntryRecordedEvent(tournamentType, periodKey, amount));

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * distributePrize(tournamentType: u8, periodKey: u256, w1: address, w2: address, w3: address)
     *
     * Called by the backend operator at prizeBlock.
     * w1/w2/w3 are the top-3 player addresses sorted by score. Pass Address.zero()
     * for missing ranks (fewer than 3 verified entrants → rollover for that slot).
     *
     * Prize splits by valid winner count:
     *   3 winners → 70 / 20 / 10 %
     *   2 winners → 80 / 20 %
     *   1 winner  → 100 %
     *   0 winners → rollover entire prizeTotal into stagingCarry
     *
     * Pool rotation (always):
     *   activeCarry[type] = stagingCarry[type]
     *   clear mainPool[type] and stagingCarry[type]
     *
     * Dev cut:
     *   transfer devPool → devWallet; clear devPool
     */
    @method(
        { name: 'tournamentType', type: ABIDataTypes.UINT8 },
        { name: 'periodKey', type: ABIDataTypes.UINT256 },
        { name: 'w1', type: ABIDataTypes.ADDRESS },
        { name: 'w2', type: ABIDataTypes.ADDRESS },
        { name: 'w3', type: ABIDataTypes.ADDRESS },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public distributePrize(calldata: Calldata): BytesWriter {
        this.requireOperator();

        const tournamentType = calldata.readU8();
        const periodKey      = calldata.readU256();
        const w1             = calldata.readAddress();
        const w2             = calldata.readAddress();
        const w3             = calldata.readAddress();

        if (tournamentType > 2) throw new Revert('PrizeDistributor: invalid tournament type');

        // Guard: prevent double distribution
        if (u256.eq(this.lastDistKey(tournamentType).value, periodKey)) {
            throw new Revert('PrizeDistributor: period already distributed');
        }

        const token = this._tokenAddress.value;

        // Compute prize total for this period
        const main    = this.mainPool(tournamentType);
        const staging = this.stagingCarry(tournamentType);
        const active  = this.activeCarry(tournamentType);

        const prizeTotal = SafeMath.add(main.value, active.value);

        // Count valid (non-zero) winners
        const v1 = !isZeroAddress(w1);
        const v2 = !isZeroAddress(w2);
        const v3 = !isZeroAddress(w3);
        const validCount: u8 = (v1 ? 1 : 0) + (v2 ? 1 : 0) + (v3 ? 1 : 0);

        // ── CEI: mark period as distributed FIRST before any external transfer ──
        // This prevents reentrancy via onTokenReceived() callbacks on winner
        // contracts from re-entering distributePrize() with the same periodKey.
        this.lastDistKey(tournamentType).value = periodKey;

        // Pool rotation: activeCarry = stagingCarry; clear main and staging
        active.value  = staging.value;
        main.value    = u256.Zero;
        staging.value = u256.Zero;

        if (!u256.eq(prizeTotal, u256.Zero)) {
            if (validCount === 0) {
                // Rollover — add entire prize to stagingCarry for next period.
                // NOTE: staging was already cleared above; we add directly to active
                // since staging is now 0. Re-read active which was just set.
                active.value = SafeMath.add(active.value, prizeTotal);
            } else if (validCount === 1) {
                // Single winner — gets 100 %
                TransferHelper.transfer(token, w1, prizeTotal);
            } else if (validCount === 2) {
                // Two winners — 80 / 20 %
                const p1 = SafeMath.div(SafeMath.mul(prizeTotal, u256.fromU32(8000)), u256.fromU32(10000));
                const p2 = SafeMath.sub(prizeTotal, p1);
                TransferHelper.transfer(token, w1, p1);
                TransferHelper.transfer(token, w2, p2);
            } else {
                // Three winners — 70 / 20 / 10 %
                const p1 = SafeMath.div(SafeMath.mul(prizeTotal, u256.fromU32(7000)), u256.fromU32(10000));
                const p2 = SafeMath.div(SafeMath.mul(prizeTotal, u256.fromU32(2000)), u256.fromU32(10000));
                const p3 = SafeMath.sub(SafeMath.sub(prizeTotal, p1), p2);
                TransferHelper.transfer(token, w1, p1);
                TransferHelper.transfer(token, w2, p2);
                TransferHelper.transfer(token, w3, p3);
            }
        }

        // Dev cut: transfer entire accumulated devPool to devWallet
        const devAmount = this._devPool.value;
        if (!u256.eq(devAmount, u256.Zero)) {
            TransferHelper.transfer(token, this._devWallet.value, devAmount);
            this._devPool.value = u256.Zero;
        }

        // ── Sponsor bonus distribution ──────────────────────────────────────────
        // If w1 is a valid winner, transfer every deposited sponsor bonus to them.
        // If there is no winner, bonuses remain locked in the contract.
        // Capped at MAX_SPONSOR_SLOTS to prevent witness-size overflow.
        {
            const countKey     = makeSponsorKey(tournamentType, periodKey, COUNT_SENTINEL);
            const sponsorCount = u32(new StoredU256(sponsorCountPointer, countKey).value.lo1);
            const slotsToProcess: u32 = sponsorCount < MAX_SPONSOR_SLOTS ? sponsorCount : MAX_SPONSOR_SLOTS;
            if (v1 && slotsToProcess > 0) {
                for (let slot: u32 = 0; slot < slotsToProcess; slot++) {
                    const slotKey    = makeSponsorKey(tournamentType, periodKey, slot);
                    const tokenAsU256 = new StoredU256(sponsorTokenPointer,  slotKey).value;
                    const bonusAmt    = new StoredU256(sponsorAmountPointer, slotKey).value;
                    if (!u256.eq(bonusAmt, u256.Zero)) {
                        const bonusToken = u256ToAddress(tokenAsU256);
                        TransferHelper.transfer(bonusToken, w1, bonusAmt);
                        this.emitEvent(new SponsorBonusDistributedEvent(
                            tournamentType, periodKey, tokenAsU256, bonusAmt, w1,
                        ));
                    }
                }
            }
        }

        this.emitEvent(new PrizeDistributedEvent(tournamentType, periodKey, w1, w2, w3, prizeTotal));

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * setOperator(newOperator: address) — deployer only
     */
    @method({ name: 'newOperator', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setOperator(calldata: Calldata): BytesWriter {
        this.requireDeployer();
        const newOperator = calldata.readAddress();
        if (isZeroAddress(newOperator)) throw new Revert('PrizeDistributor: zero operator');
        this._operator.value = newOperator;
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * setDevWallet(newDevWallet: address) — deployer only
     */
    @method({ name: 'newDevWallet', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setDevWallet(calldata: Calldata): BytesWriter {
        this.requireDeployer();
        const newDevWallet = calldata.readAddress();
        if (isZeroAddress(newDevWallet)) throw new Revert('PrizeDistributor: zero dev wallet');
        this._devWallet.value = newDevWallet;
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * depositBonus(tournamentType: u8, periodKey: u256, tokenAddress: address, amount: u256)
     *
     * Called by the backend operator to record a sponsor bonus for a future prize period.
     * The operator must verify the off-chain OP-20 transfer of `amount` `tokenAddress` tokens
     * to this contract address before calling. Non-refundable once deposited.
     *
     * Unlimited sponsor slots per (tournamentType, periodKey). Each slot stores:
     *   - the OP-20 token contract address (as u256)
     *   - the bonus amount in raw token units
     *
     * At distributePrize() time, all bonus slots for the period are transferred to w1 (1st place).
     * If there is no valid winner, bonus tokens remain locked in the contract.
     */
    @method(
        { name: 'tournamentType', type: ABIDataTypes.UINT8 },
        { name: 'periodKey', type: ABIDataTypes.UINT256 },
        { name: 'tokenAddress', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public depositBonus(calldata: Calldata): BytesWriter {
        this.requireOperator();

        const tournamentType = calldata.readU8();
        const periodKey      = calldata.readU256();
        const tokenAddress   = calldata.readAddress();
        const amount         = calldata.readU256();

        if (tournamentType > 2) {
            throw new Revert('PrizeDistributor: invalid tournament type');
        }
        if (u256.eq(this.lastDistKey(tournamentType).value, periodKey)) {
            throw new Revert('PrizeDistributor: period already distributed');
        }
        if (u256.eq(amount, u256.Zero)) {
            throw new Revert('PrizeDistributor: zero bonus amount');
        }
        if (isZeroAddress(tokenAddress)) {
            throw new Revert('PrizeDistributor: zero bonus token address');
        }
        // periodKey must fit in u64 (block numbers do; sponsor key only encodes lo1)
        if (periodKey.lo2 !== 0 || periodKey.hi1 !== 0 || periodKey.hi2 !== 0) {
            throw new Revert('PrizeDistributor: periodKey exceeds u64');
        }

        const tokenAsU256 = addressToU256(tokenAddress);

        // Read current slot count for this (type, periodKey)
        const countKey   = makeSponsorKey(tournamentType, periodKey, COUNT_SENTINEL);
        const countStore = new StoredU256(sponsorCountPointer, countKey);
        const currentCount: u256 = countStore.value;
        const slotIndex: u32     = u32(currentCount.lo1);

        // Enforce slot cap to keep distribution witness size bounded
        if (slotIndex >= MAX_SPONSOR_SLOTS) {
            throw new Revert('PrizeDistributor: sponsor slot cap reached');
        }

        // Write token address and amount at this slot
        const slotKey = makeSponsorKey(tournamentType, periodKey, slotIndex);
        new StoredU256(sponsorTokenPointer,  slotKey).value = tokenAsU256;
        new StoredU256(sponsorAmountPointer, slotKey).value = amount;

        // Increment count
        countStore.value = SafeMath.add(currentCount, u256.fromU32(1));

        this.emitEvent(new SponsorBonusDepositedEvent(
            tournamentType, periodKey, tokenAsU256, amount, slotIndex,
        ));

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }
}
