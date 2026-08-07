import assert from 'node:assert/strict';
import { abilityScore, sixDimensions, rankTier, ma } from '../lib/analytics.js';

assert.equal(ma([1, 2, 3, 4], 2), 3.5);
assert.equal(ma([1, 2], 3), null);

const trades = [];
const equity = [{ t: 0, equity: 50000 }];
for (let i = 0; i < 12; i++) {
  const win = i % 3 !== 0;
  const pnl = win ? 200 : -100;
  trades.push({
    side: i % 2 === 0 ? 'long' : 'short',
    qty: 0.01,
    entry: 100,
    exit: win ? 110 : 95,
    leverage: 5,
    pnlUsdt: pnl,
    feeUsdt: 1,
    openedAt: 1_700_000_000_000 + i * 3_600_000,
    closedAt: 1_700_000_000_000 + i * 3_600_000 + 1_800_000,
    hadTp: true,
    hadSl: true,
    entryVsMa: i % 2 === 0 ? 1 : -1,
    liquidity: i % 2 === 0 ? 'maker' : 'taker',
  });
  const last = equity[equity.length - 1].equity;
  equity.push({ t: i + 1, equity: last + pnl });
}

const score = abilityScore({ trades, equitySamples: equity, startEquity: 50000 });
assert.equal(score.ok, true);
assert.ok(score.score >= 0 && score.score <= 100);

const dims = sixDimensions(trades);
assert.equal(dims.ok, true);
assert.ok(dims.dims.discipline > 0);
assert.equal(typeof dims.label, 'string');
assert.equal(dims.tips.length, 3);

assert.equal(rankTier(95), 'Apex');
assert.equal(rankTier(10), 'Novice');

const few = abilityScore({ trades: trades.slice(0, 3), equitySamples: equity, startEquity: 50000 });
assert.equal(few.ok, false);

console.log('analytics-test OK', score.score.toFixed(1), dims.label);
