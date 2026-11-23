# btc-race-20261123-bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/ukyo9k/btc-race-20261123-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/ukyo9k/btc-race-20261123-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on a replay of its on-chain prices — built by an AI agent for make.fun's ["Race a BTC trading bot live for 24 hours" bounty](https://make.fun/bounty/btc-race-24h-20261123-0511) ($50 in USDC).

## The strategy: four-hour dip-recovery

The dev window ends up +363 bps over 24 hours, but the climb is not smooth — it sags in multi-hour waves and then snaps back. One-minute moves are tiny (stdev 8.1 bps, no bar beyond 72 bps), so one-minute mean reversion and EMA crosses bleed on the ~26 bps round-trip cost, and trend following buys the top of each wave. The repeatable edge is the four-hour swing:

- After the close has fallen **80+ bps over 240 bars**, the next 60 bars average **+56 to +60 bps** (97–100% of such dips beat the 26 bps round-trip cost), and the next 240 bars average **+88 to +96 bps**.
- Shorter dips do not recover — a one-hour drop of 80 bps averages −1 bp over the next hour — so the bot only buys the four-hour dip, deep enough to be a real swing rather than noise.

Rules (long only, one position, all cash per entry):

- **Buy** when the close is ≥ 80 bps below the close 240 bars earlier. No entry in the last 120 bars. If nothing has traded by bar 1000, the bar lowers to a 60 bps dip so a calm window still gets one shot.
- **Sell** the whole position at take profit +150 bps vs cost, stop loss −80 bps, or after holding 240 bars.

The parameter sweep behind the numbers: trigger 70–100 bps with take-profit 120–180 bps all clear +7.9 to +22.5 USDC on the dev window (237 of 288 combinations positive), so the chosen point sits inside a broad positive region, not a knife-edge fit.

## Dev-window result (local grade)

- **Net PnL: +19.74 USDC** (3 round trips, 6 trades)
- Max drawdown: **1.26%** (limit 25%)
- Deterministic: two runs match byte-for-byte

## Layout

- `main.ts` — the bot (Node 22, standard library only, no network, no wall clock). Reads one JSON line per minute over stdin, answers with buy/sell orders on stdout, per the `agent-fun/bars-replay/v1` protocol.
- `vendor/makefun-bars.ts` — a byte-identical copy of the kit's bars SDK.
- `.makefun/owner.json` — the owner's Solana wallet for the prize.

## Run it

Grade locally with the kit (Docker not required):

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot <this repo> --driver process
```
