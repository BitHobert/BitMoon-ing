/**
 * Postinstall patch: add missing ./sha2.js export to @noble/hashes v1.x
 * nested inside @btc-vision/transaction.
 *
 * @btc-vision/transaction ESM build imports "@noble/hashes/sha2.js" (with .js)
 * but @noble/hashes v1.6.1's exports map only lists "./sha2" (no extension).
 * This script adds the missing alias so Node can resolve it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkgPaths = [
    'node_modules/@btc-vision/transaction/node_modules/@noble/hashes/package.json',
    'node_modules/@noble/hashes/package.json',
];

for (const rel of pkgPaths) {
    const path = resolve(process.cwd(), rel);
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        continue;
    }

    const exports = pkg.exports ?? {};
    let patched = false;

    // Add ./sha2.js → ./sha2.js if missing
    if (exports['./sha2'] && !exports['./sha2.js']) {
        exports['./sha2.js'] = exports['./sha2'];
        patched = true;
    }

    // Add ./sha256.js → ./sha256.js if missing
    if (exports['./sha256'] && !exports['./sha256.js']) {
        exports['./sha256.js'] = exports['./sha256'];
        patched = true;
    }

    if (patched) {
        pkg.exports = exports;
        writeFileSync(path, JSON.stringify(pkg, null, 2));
        console.log(`[patch-noble-hashes] Patched: ${rel}`);
    } else {
        console.log(`[patch-noble-hashes] No patch needed: ${rel}`);
    }
}
