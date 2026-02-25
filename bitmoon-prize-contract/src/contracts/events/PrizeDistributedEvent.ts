import { u256 } from '@btc-vision/as-bignum/assembly';
import { Address, ADDRESS_BYTE_LENGTH, BytesWriter, NetEvent } from '@btc-vision/btc-runtime/runtime';

// tournamentType(u8) + periodKey(u256) + w1(addr) + w2(addr) + w3(addr) + totalPrize(u256)
const PRIZE_DISTRIBUTED_DATA_SIZE: u32 = 1 + 32 + ADDRESS_BYTE_LENGTH * 3 + 32;

@final
export class PrizeDistributedEvent extends NetEvent {
    constructor(
        tournamentType: u8,
        periodKey: u256,
        w1: Address,
        w2: Address,
        w3: Address,
        totalPrize: u256,
    ) {
        const data = new BytesWriter(PRIZE_DISTRIBUTED_DATA_SIZE);
        data.writeU8(tournamentType);
        data.writeU256(periodKey);
        data.writeAddress(w1);
        data.writeAddress(w2);
        data.writeAddress(w3);
        data.writeU256(totalPrize);
        super('PrizeDistributed', data);
    }
}
