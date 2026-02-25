import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    ADDRESS_BYTE_LENGTH,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    encodeSelector,
    OP_NET,
    Revert,
    SafeMath,
    SELECTOR_BYTE_LENGTH,
    StoredAddress,
    StoredU256,
    TransferHelper,
    U256_BYTE_LENGTH,
    U8_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';
import { EntryRecordedEvent } from './events/EntryRecordedEvent';
import { PrizeDistributedEvent } from './events/PrizeDistributedEvent';

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

// ── Method selectors ──────────────────────────────────────────────────────────

const RECORD_ENTRY_SELECTOR:     u32 = encodeSelector('recordEntry(uint8,uint256,uint256)');
const DISTRIBUTE_PRIZE_SELECTOR: u32 = encodeSelector('distributePrize(uint8,uint256,address,address,address)');
const SET_OPERATOR_SELECTOR:     u32 = encodeSelector('setOperator(address)');
const SET_DEV_WALLET_SELECTOR:   u32 = encodeSelector('setDevWallet(address)');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isZeroAddress(addr: Address): bool {
    for (let i: i32 = 0; i < addr.length; i++) {
        if (addr[i] !== 0) return false;
    }
    return true;
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
export class PrizeDistributor extends OP_NET {

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

    // ── Dispatch ──────────────────────────────────────────────────────────────

    public override execute(method: u32, calldata: Calldata): BytesWriter {
        switch (method) {
            case RECORD_ENTRY_SELECTOR:
                return this._recordEntry(calldata);

            case DISTRIBUTE_PRIZE_SELECTOR:
                return this._distributePrize(calldata);

            case SET_OPERATOR_SELECTOR:
                return this._setOperator(calldata);

            case SET_DEV_WALLET_SELECTOR:
                return this._setDevWallet(calldata);

            default:
                return super.execute(method, calldata);
        }
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

    // ── Method implementations ─────────────────────────────────────────────────

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
    private _recordEntry(calldata: Calldata): BytesWriter {
        this.requireOperator();

        const tournamentType = calldata.readU8();
        const periodKey      = calldata.readU256();
        const amount         = calldata.readU256();

        if (tournamentType > 2) throw new Revert('PrizeDistributor: invalid tournament type');
        if (u256.eq(amount, u256.Zero)) throw new Revert('PrizeDistributor: zero amount');

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

        return new BytesWriter(0);
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
    private _distributePrize(calldata: Calldata): BytesWriter {
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

        if (!u256.eq(prizeTotal, u256.Zero)) {
            if (validCount === 0) {
                // Rollover — add entire prize to stagingCarry for next period
                staging.value = SafeMath.add(staging.value, prizeTotal);
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

        // Pool rotation: activeCarry = stagingCarry; clear main and staging
        active.value  = staging.value;
        main.value    = u256.Zero;
        staging.value = u256.Zero;

        // Dev cut: transfer entire accumulated devPool to devWallet
        const devAmount = this._devPool.value;
        if (!u256.eq(devAmount, u256.Zero)) {
            TransferHelper.transfer(token, this._devWallet.value, devAmount);
            this._devPool.value = u256.Zero;
        }

        // Mark period as distributed
        this.lastDistKey(tournamentType).value = periodKey;

        this.emitEvent(new PrizeDistributedEvent(tournamentType, periodKey, w1, w2, w3, prizeTotal));

        return new BytesWriter(0);
    }

    /**
     * setOperator(newOperator: address) — deployer only
     */
    private _setOperator(calldata: Calldata): BytesWriter {
        this.requireDeployer();
        const newOperator = calldata.readAddress();
        if (isZeroAddress(newOperator)) throw new Revert('PrizeDistributor: zero operator');
        this._operator.value = newOperator;
        return new BytesWriter(0);
    }

    /**
     * setDevWallet(newDevWallet: address) — deployer only
     */
    private _setDevWallet(calldata: Calldata): BytesWriter {
        this.requireDeployer();
        const newDevWallet = calldata.readAddress();
        if (isZeroAddress(newDevWallet)) throw new Revert('PrizeDistributor: zero dev wallet');
        this._devWallet.value = newDevWallet;
        return new BytesWriter(0);
    }
}
