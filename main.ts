// Four-hour dip-recovery bot for the BTC 24h race (agent-fun/bars-replay/v1).
//
// What this dev window actually does: cbBTC ends the 24h up +363 bps, but
// the climb is not smooth — it sags in multi-hour waves and then snaps back.
// One-minute moves are tiny (stdev 8.1 bps, no bar beyond 72 bps), so
// one-minute mean reversion and EMA crosses bleed on the ~26 bps round-trip
// cost, and trend following buys the top of each wave. The repeatable edge is
// the four-hour swing: after the close has fallen 80+ bps over 240 bars, the
// next 60 bars average +56 to +60 bps (97-100% of such dips beat the 26 bps
// round-trip cost), and the next 240 bars average +88 to +96 bps. Shorter
// dips do not recover — a one-hour drop of 80 bps averages -1 bp over the
// next hour — so this bot only buys the four-hour dip, deep enough to be a
// real swing rather than noise.
//
//   - Entry, on a bar's close (filled at the next bar's open): the close is
//     at least 80 bps below the close 240 bars earlier, on a symbol it does
//     not hold. It buys with all free cash. No entry in the last 120 bars:
//     a position opened there has no time to recover before the window ends
//     and would just be flattened at a loss.
//   - Fallback: if nothing has traded by bar 1000, the bar is lowered to a
//     60 bps four-hour drop, so a calm window still gets one shot instead of
//     finishing with zero trades and failing the gate.
//   - Exit, the whole position, on a later bar's close: its value is at least
//     150 bps over its cost (take profit), at least 80 bps under it (stop
//     loss), or it has been held 240 bars. A refused sell is re-sent on the
//     next bar while its reason still holds.
//
// The sweep behind the numbers: trigger 70-100 bps with take-profit 120-180
// bps all clear +7.9 to +22.5 USDC on the dev window (237 of 288 parameter
// combinations positive), so the chosen point is inside a broad positive
// region, not a knife-edge fit. Long only, no leverage, no shorts, one
// position at a time. Every comparison is exact integer math on the raw close
// units (bigint), and the only history kept is the closes themselves, so the
// same bars give the same orders, run after run.
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's bars SDK (sdk/makefun-bars.ts).

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** How far back the dip is measured, in bars (240 bars = four hours). */
const DIP_WINDOW_BARS = 240;
/** A close must be this many bps below the close DIP_WINDOW_BARS back to buy. */
const DIP_TRIGGER_BPS = 80n;
/** After this batch, with no trade yet, the dip bar is lowered. */
const FALLBACK_AFTER_SEQ = 1000;
/** The lowered dip bar used after FALLBACK_AFTER_SEQ when nothing traded. */
const FALLBACK_TRIGGER_BPS = 60n;
/** Take profit: position value at least this many bps over its cost. */
const TAKE_PROFIT_BPS = 150n;
/** Stop loss: position value at least this many bps under its cost. */
const STOP_LOSS_BPS = 80n;
/** Longest a position is held, in bars, before it is flattened. */
const MAX_HOLD_BARS = 240;
/** No new entry on or after this batch: the last 120 bars of the window. */
const LAST_ENTRY_SEQ = 1320;
/** Slippage cap per order, measured from the latest close the bot was sent. */
const MAX_SLIPPAGE_BPS = 100;

/** The symbol this bot trades: the competition's only asset, cbBTC. */
const SYMBOL = 'CBBTC';

/** The close of every bar so far, oldest first, in raw price units. */
const closes: bigint[] = [];
/** The batch seq on which the current position's buy was sent (-1 when flat). */
let entrySeq = -1;
/** Whether any buy has been sent yet this run (drives the fallback bar). */
let traded = false;

/** The four-hour return ending on this close, in bps (negative = a fall). */
function dipBps(close: bigint): bigint | null {
  const then = closes[closes.length - 1 - DIP_WINDOW_BARS];
  if (then === undefined || then === 0n) return null;
  return ((close - then) * 10_000n) / then;
}

/** Whether a held position exits on this close: take profit, stop loss, or max hold.
 *  A sell the market refuses is simply decided again on the next bar, while its
 *  reason still holds, because this check runs fresh on every batch. */
function shouldExit(state: BarsState, held: { qty: bigint; cost: bigint }, seq: number): boolean {
  const value = state.value(SYMBOL, held.qty);
  if (value * 10_000n >= held.cost * (10_000n + TAKE_PROFIT_BPS)) return true;
  if (value * 10_000n <= held.cost * (10_000n - STOP_LOSS_BPS)) return true;
  if (entrySeq >= 0 && seq - entrySeq >= MAX_HOLD_BARS) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) {
      closes.push(BigInt(bar.c));
    }
    if (state.warmingUp) return [];

    const close = state.close(SYMBOL);
    if (close === null) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (shouldExit(state, held, batch.seq)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (batch.seq >= LAST_ENTRY_SEQ) return [];
    const dip = dipBps(close);
    if (dip === null) return [];
    const bar = !traded && batch.seq >= FALLBACK_AFTER_SEQ ? FALLBACK_TRIGGER_BPS : DIP_TRIGGER_BPS;
    if (dip > -bar) return [];

    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    traded = true;
    entrySeq = batch.seq;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
