# Uma Musume: Pretty Derby — Game Context for Bot Development

> What agents need to know about the game to build this bot correctly.

---

## What Is This Game?

Uma Musume: Pretty Derby is a mobile game by Cygames where players raise anthropomorphized racehorses ("horse girls") and compete in races. The game has a social component where players form clubs called **circles**.

## What Is a Circle?

A circle (team/club) is a group of up to 30 players who compete together. Circles have:
- A leader and optional sub-leader
- A custom name and description
- A combined fan count that determines their ranking
- A tier (D through SS) based on ranking position

## What Are Fans?

Fans are the primary metric. Players earn fans by:
- Running career training sessions
- Winning races (G1 races earn the most)
- Participating in team events

Fan count is cumulative across all of a player's trained characters. The circle's total is the sum of all members' individual fan counts.

The `daily_fans` array we track is a member's cumulative fan count for each day of the month. It's not "fans earned today" — it's "total fans as of today."

## How Do Circles Compete?

Circles are ranked by total monthly fan count. The ranking determines their tier:

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

Each tier has promotion and demotion thresholds. The API provides `fans_to_next_tier` (how many fans needed to promote) and `fans_to_lower_tier` (how many fans above demotion threshold).

## What Is the Requirement System?

Circle leaders set monthly fan requirements for members. If a member doesn't meet the requirement, they may be kicked.

From the example circle: "7 Days Not do Req = K1CK. Req. 7-20m Weekly Fans!"

This means: if a member doesn't meet the requirement for 7 consecutive days, they get kicked. The weekly requirement is 7-20 million fans.

Leaders track this manually or with bots. Our bot automates this tracking.

## What Data Is Available?

uma.moe is a third-party platform that scrapes game data once daily at 00:00 JST (22:00 WIB). It provides:
- Circle metadata (name, rank, tier, member count)
- Per-member cumulative daily fans (32-element array)
- Transfer history (which club a member came from)
- Club rankings among all tracked circles
- Tier thresholds (exact fans needed for promotion/demotion)

See `docs/uma-moe-api.md` for the API documentation (not official, reverse engineered and may be outdated).
See `tests/examples/snapshot-june-12.json` for real data.

## What Is the Bot's Job?

The bot helps circle leaders by:
1. Tracking member fan progress automatically
2. Sending daily/weekly/monthly reports to WhatsApp
3. Identifying members below requirement
4. Tracking tier promotion/demotion risk
5. Detecting performance drops early
6. Providing competitive context (how the circle ranks)

## Key Concepts for Development

- **Circle**: The club/team. Up to 30 members.
- **Member**: A player in the circle. Has a trainer name and viewer ID.
- **Fans**: Cumulative metric earned through gameplay. Higher = better.
- **daily_fans**: 32-element array. Index 0 = Day 1. Cumulative fans at end of each day.
- **Transfer**: Member joined from another circle. Indicated by negative values in daily_fans.
- **Requirement**: Minimum monthly fans a member must earn. Set by leader.
- **Tier**: Circle's competitive bracket (D to SS). Determined by ranking position.
- **Promotion/Demotion**: Moving up or down tiers based on fan count relative to thresholds.
