import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { PrizeDistributor } from './contracts/PrizeDistributor';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';

// DO NOT TOUCH THIS.
Blockchain.contract = () => {
    // ONLY CHANGE THE CONTRACT CLASS NAME.
    // DO NOT ADD CUSTOM LOGIC HERE.
    return new PrizeDistributor();
};

// VERY IMPORTANT
export * from '@btc-vision/btc-runtime/runtime/exports';

// VERY IMPORTANT
export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}
