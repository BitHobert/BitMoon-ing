import { u256 } from '@btc-vision/as-bignum/assembly';
import { BytesWriter, NetEvent } from '@btc-vision/btc-runtime/runtime';

const ENTRY_RECORDED_DATA_SIZE: u32 = 1 + 32 + 32; // tournamentType(u8) + periodKey(u256) + amount(u256)

@final
export class EntryRecordedEvent extends NetEvent {
    constructor(tournamentType: u8, periodKey: u256, amount: u256) {
        const data = new BytesWriter(ENTRY_RECORDED_DATA_SIZE);
        data.writeU8(tournamentType);
        data.writeU256(periodKey);
        data.writeU256(amount);
        super('EntryRecorded', data);
    }
}
