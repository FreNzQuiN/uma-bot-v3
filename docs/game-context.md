# Uma Musume: Pretty Derby — Game Context

## What Is This Game?

A mobile game by Cygames where players raise anthropomorphized racehorses and compete in races. Players form clubs called **circles**. Circles are ranked by total monthly fan count. Higher rank = better tier = better rewards.

The bot exists because tracking ~30 members' fan progress manually is tedious and error-prone. Leaders check uma.moe daily, mentally compare numbers, and decide who's meeting requirements. The bot automates this.

## What Is a Circle?

A team of up to 30 players. Has a leader, a name, a combined fan count, and a tier (D through SS) based on ranking position.

**What the bot tracks:** Member count, rank, tier, promotion/demotion thresholds, daily fan totals.

## What Are Fans?

The primary metric. Players earn fans by training, racing, and participating in events. Fan count is cumulative — it only goes up (unless a member transfers out).

**What the bot does with this:** The `daily_fans` array is a member's cumulative fan count for each day. The bot computes daily gain (today minus yesterday), weekly gain (sum of daily gains in a week block), and monthly gain (today minus day 1). Every report is different arithmetic on this array.

## How Do Circles Compete?

Ranked by total monthly fan count. The ranking determines their tier:

| Tier | Ranking Position |
|------|-----------------|
| SS | 1-10 |
| S+ | 11-30 |
| S | 31-100 |
| A+ | 101-500 |
| A | 501-1000 |
| B+ | 1001-3000 |
| B | 3001-5000 |
| C+ | 5001-7000 |
| C | 7001-10000 |
| D+ | 10001+ |
| D | Unranked |

Each tier has promotion and demotion thresholds. The API provides `fans_to_next_tier` and `fans_to_lower_tier`.

**What the bot does with this:** The tier report shows promotion gap, demotion buffer, required daily pace, and projected outcome. Alerts fire when the club is at risk of demoting.

## What Is the Requirement System?

Circle leaders set monthly fan requirements. Members who don't meet them may be kicked. Example: "7 Days Not do Req = K1CK. Req. 7-20m Weekly Fans!"

**What the bot does with this:** Reports show which members are below requirement. The `/bottom` command lists members needing attention. The weekly report includes a below-requirement section when `weeklyFans` is configured.

## What Data Is Available?

uma.moe is a third-party platform that scrapes game data once daily at 00:00 JST (22:00 WIB). It provides:
- Circle metadata (name, rank, tier, member count)
- Per-member cumulative daily fans (32-element array)
- Transfer history (which club a member came from)
- Club rankings among all tracked circles
- Tier thresholds (exact fans needed for promotion/demotion)

**Why once daily:** The game updates player stats once per day. uma.moe scrapes after the update. The bot fetches after that (22:05 WIB — 5-minute buffer for data to settle).

See `docs/uma-moe-api.md` for the full API documentation (reverse-engineered, may be outdated).
See `tests/examples/snapshot-june-12.json` for real data.

## Key Concepts

- **Circle**: The club/team. Up to 30 members.
- **Member**: A player in the circle. Has a trainer name and viewer ID.
- **Fans**: Cumulative metric earned through gameplay. Higher = better.
- **daily_fans**: 32-element array. Index 0 = Day 1. Cumulative fans at end of each day.
- **Transfer**: Member joined from another circle. Indicated by negative values in daily_fans.
- **Requirement**: Minimum monthly fans a member must earn. Set by leader.
- **Tier**: Circle's competitive bracket (D to SS). Determined by ranking position.
- **Promotion/Demotion**: Moving up or down tiers based on fan count relative to thresholds.
