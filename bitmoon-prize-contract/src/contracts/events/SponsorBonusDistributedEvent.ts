import { u256 } from '@btc-vision/as-bignum/assembly';
import { Address, ADDRESS_BYTE_LENGTH, BytesWriter, NetEvent } from '@btc-vision/btc-runtime/runtime';

// tournamentType(u8) + periodKey(u256) + tokenAddress(u256) + amount(u256) + recipient(address)
const SPONSOR_BONUS_DISTRIBUTED_DATA_SIZE: u32 = 1 + 32 + 32 + 32 + ADDRESS_BYTE_LENGTH;

@final
export class SponsorBonusDistributedEvent extends NetEvent {
    constructor(
        tournamentType: u8,
        periodKey: u256,
        tokenAddressAsU256: u256,
        amount: u256,
        recipient: Address,
    ) {
        const data = new BytesWriter(SPONSOR_BONUS_DISTRIBUTED_DATA_SIZE);
        data.writeU8(tournamentType);
        data.writeU256(periodKey);
        data.writeU256(tokenAddressAsU256);
        data.writeU256(amount);
        data.writeAddress(recipient);
        super('SponsorBonusDistributed', data);
    }
}
