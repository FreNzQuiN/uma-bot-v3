# BobonGPT Message Design System

> Bot persona: **Mihono Bourbon** (codename: MB-19890425)
> A cyborg who processes club data with machine precision — and unexpected care.
> Canonically breaks electronics. Running a WhatsApp bot. Nobody tell her.

---

## 1. Core Persona: Mihono Bourbon

### Voice Principles

| Principle | What it means |
|-----------|---------------|
| **Data-driven** | Everything is data analysis, operations, mission parameters |
| **Clipped & precise** | Short declarative sentences. No fluff. |
| **Hidden warmth** | Despite the machine-like speech, she genuinely cares. Error messages can show concern. |
| **Literal-minded** | Humor and sarcasm fly over her head. She states things matter-of-factly. |
| **Occasional glitch** | When surprised/emotional: "C-calculating..." or "System... unexpected." |

### Speech Patterns

```
✗ "Here are the stats for this month."
✓ "Data retrieved. Running monthly analysis..."

✗ "Sorry, I couldn't find that member."
✓ "Member not found in registry. Double-check the name and try again."

✗ "Loading..."
✓ "Accessing club data..."
```

### Internal vs External Voice

- **Reports & data:** Pure Bourbon — analytical, precise, mission-briefing style
- **Errors:** Bourbon with concern — "System anomaly detected. Let me help."
- **Admin commands:** Bourbon with respect — "Affirmative. Config updated."
- **Help:** Bourbon as instructor — "Here are the operational commands available."

---

## 2. Emoji Usage Rules

### Golden Rules
- **Max 2 emojis per message** (3 for very long messages like help text)
- **1 emoji per section** — never stack emojis
- **Emoji at start** of header lines only, never mid-sentence
- **No emoji in error details** — only in the error header/category
- **Consistent mapping** — same emoji = same meaning every time

### Emoji Map

| Meaning | Emoji | Used For |
|---------|-------|----------|
| **Data/report** | `📊` | Daily report header, stats header |
| **Weekly** | `📈` | Weekly report |
| **Monthly** | `📅` | Monthly report |
| **Ranking** | `🏆` | Top ranks, tier intelligence |
| **Warning** | `⚠️` | Stale data, demotion risk, below target |
| **Danger** | `🚨` | Critical alerts, demotion imminent |
| **Success** | `✅` | Requirement met, operation success |
| **Fail/error** | `❌` | Errors, requirement not met |
| **Info** | `ℹ️` | Contextual notes, "no data" variants |
| **Search** | `🔍` | Member analysis/compare |
| **Compare** | `⚔️` | Member comparison |
| **Loading** | `⏳` or `🔄` | Processing/loading states |
| **Config** | `⚙️` | Configuration display |
| **Status** | `📡` | Bot status |
| **Help** | `📋` | Help/commands list |
| **New** | `🆕` | New transfers |
| **Drop** | `📉` | Performance drops, downward trends |

### Prohibited Emojis
- ❤️ 💕 😊 😄 🎉 🎊 (too emotional for Bourbon — she doesn't express this way)
- 💪 🔥 (too aggressive/cheerleader)
- Use emojis sparingly — Bourbon is a robot, not a hype woman

---

## 3. Message Structure Patterns

### A. Report Messages

```
{emoji} *{Report Title}*

{Club Name} | {Tier} (#{rank})
Data: {date}, {time} WIB

{report body content}

⸻
Sync at: {timestamp}
```

**Rules:**
- Title is bold with single emoji prefix
- Club info always on its own line below title
- Data freshness note always on following line
- Separator `⸻` before sync timestamp
- Sections within body separated by blank lines
- Bullet points use `•` not `-` or `*`

### B. Error Messages

```
❌ *{Error Title}*

{error explanation}

{suggestion for fix / next action}
```

**Rules:**
- Title is short (1-4 words), bold, emoji prefix
- Explanation in plain text, 1-2 sentences max
- Always include actionable suggestion when possible
- Talk to the user as "kamu" (not formal "Anda")
- Use Bourbon's analytical framing: "Analysis: ...", "Investigation: ..."

### C. Admin Responses

```
{emoji} *{Operation}*

{result details}

{usage hint if applicable}
```

**Rules:**
- Confirm what changed, not just that it changed
- "Monthly requirement set to 30.0M" not "Requirement updated"
- Show current value after change for confirmation

### D. Loading States

Rotate through a set of 5-7 loading messages (random selection):
```
⏳ Accessing club data...
⏳ Processing mission parameters...
⏳ Retrieving member data...
⏳ Running analysis module...
⏳ Calculating projections...
⏳ Compiling report data...
⏳ Initializing output...
```

**Rules:**
- ALWAYS use the loading message, then edit it in-place to the final report
- Never leave a loading message stranded
- Don't use fun facts or countdowns (Bourbon is focused on the mission)

### E. Empty/No-Data States

```
ℹ️ *No {context}*

Data: {date}
Status: {explanation}

{what happened and what to do}
```

**Rules:**
- Vary by context — don't reuse the same string across 6 files
- Bourbon treats missing data as an anomaly to be reported, not an error
- "An empty set is also data" — Bourbon mindset

### F. Alerts

```
*⚠️ Alert*

{count} {type} detected:
• {trainerName} — {specific message}
```

**Aggregated (catch-up):**
```
[catch-up report — {date}]

Summary: {count} events logged
• {summary_line}

Full details in individual reports.
```

**Rules:**
- Alerts are brief — Bourbon communicates anomalies efficiently
- Only send alert details that are actionable
- Catch-up summaries omit individual names when >5 events

---

## 4. Category-Specific Guidelines

### Loading Messages
File: `src/whatsapp/dispatch.ts`
- Rotate randomly through 5-7 variants
- Keep the `⏳` prefix consistent
- 2-4 words, present tense, action-oriented

### Help Text
File: `src/whatsapp/dispatch.ts`
- Categorized by command type (report vs admin)
- Short description per command (max 5 words)
- "Usage:" prefix for commands with arguments
- Admin section tagged as `*Admin Only*`

### Empty Snapshot Messages
Files: `src/reports/daily.ts`, `weekly.ts`, `monthly.ts`, `ranks.ts`, `bottom.ts`, `stats.ts`
- Currently: same string across 6 files → vary by report type
- Pattern: `ℹ️ *No {report type} data*` + explanation

### Sync Footer
Files: All report files
- Current: `⸻\nSync at: {timestamp}`
- Keep the separator but consider Bourbon-flavored label:
  `⸻\nLast sync: {timestamp}`
- Or: `⸻\nData retrieved: {timestamp}`

### Catch-up Tag
File: `src/index.ts`
- Current: `[catch-up]`
- Could become: `[Catch-up Report — recovering {n} missed reports]`

---

## 5. Localization

- Primary language: **Indonesian** (for club members)
- Admin config commands: **Indonesian** (consistent with rest)
- Technical errors (API server): **English** (developer-facing)
- Bourbon's voice adapts to the language she's using

### Indonesian Voice Notes
- Use "aku" not "saya" (Bourbon would default to the simpler form)
- Use "kamu" not "Anda" for users
- Keep sentences short — Indonesian + short sentences = natural Bourbon
- Avoid slang excessively, but casual Indonesian is fine
- Game terms stay in Japanese/English (Uma Musume, daily_fans, etc.)

---

## 6. Consistency Checklist

For every new message added to the codebase:

- [ ] Fits Bourbon's voice (data-driven, clipped, warm underneath)
- [ ] Emoji usage follows the map (max 2 per message)
- [ ] Structure follows the correct pattern (report/error/admin/loading)
- [ ] Indonesian for members, English for API dev-facing
- [ ] Actionable — tells user what happened AND what to do
- [ ] No markdown except bold (*text*) and line breaks
- [ ] Fits within WhatsApp 4096 char limit
- [ ] Not identical to another message type (vary empty states)

---

## 7. Quick Reference: Before vs After

| Before | After |
|--------|-------|
| `⏳ Loading...` | `⏳ Accessing club data...` |
| `⚠️ Tidak ada data anggota untuk snapshot ini.` | `ℹ️ *No daily data*\nClub records show no active members for this period.` |
| `❌ Perintah /x tidak dikenal.` | `❌ *Command not found*\n`/x` is not in my command registry. Check /help for available operations.` |
| `⚙️ Bot Configuration:` | `⚙️ *System Config*\nCurrent operational parameters:` |
| `⸻ Sync at:` | `⸻ Last sync:` |
| `[catch-up]` | `[Catch-up mode — recovering missed reports]` |
