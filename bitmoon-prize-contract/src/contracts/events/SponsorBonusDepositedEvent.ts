import { u256 } from '@btc-vision/as-bignum/assembly';
import { BytesWriter, NetEvent } from '@btc-vision/btc-runtime/runtime';

// tournamentType(u8) + periodKey(u256) + tokenAddress(u256) + amount(u256) + slotIndex(u32)
const SPONSOR_BONUS_DEPOSITED_DATA_SIZE: u32 = 1 + 32 + 32 + 32 + 4;

@final
export class SponsorBonusDepositedEvent extends NetEvent {
    constructor(
        tournamentType: u8,
        periodKey: u256,
        tokenAddressAsU256: u256,
        amount: u256,
        slotIndex: u32,
    ) {
        const data = new BytesWriter(SPONSOR_BONUS_DEPOSITED_DATA_SIZE);
        data.writeU8(tournamentType);
        data.writeU256(periodKey);
        data.writeU256(tokenAddressAsU256);
        data.writeU256(amount);
        data.writeU32(slotIndex);
        super('SponsorBonusDeposited', data);
    }
}
