# data-openings

Watches for new data analyst internship postings and pings a Discord channel when one opens.

## How it works

Polls the [Simplify / Pitt CSC internship feed](https://github.com/SimplifyJobs/Summer2027-Internships) (~14,000 listings, refreshed hourly), filters for analyst roles, and posts anything it hasn't seen before. Seen listings are tracked in `seen.json`, which the workflow commits back to the repo after each run.

## Setup

1. Create a Discord webhook: Server Settings → Integrations → Webhooks → New Webhook → copy URL.
2. Add it as a repo secret named `WEBHOOK_URL` (Settings → Secrets and variables → Actions).
3. Settings → Actions → General → Workflow permissions → **Read and write**.
4. Seed locally so the first run doesn't dump every open role:
   ```bash
   python3 job_bot.py --seed
   git add seen.json && git commit -m "seed" && git push
   ```
5. Actions tab → **job watch** → Run workflow.

## Commands

```bash
python3 job_bot.py --dry-run    # print matches, post nothing, touch nothing
python3 job_bot.py --test 3     # post 3 newest to Discord, don't touch state
python3 job_bot.py --seed       # mark everything open as seen, post nothing
python3 job_bot.py              # normal run: post new roles, update state
```

Set `WEBHOOK_URL` in your shell before running anything that posts.

## Configuration

All at the top of `job_bot.py`:

| Setting | Purpose |
|---|---|
| `INCLUDE` | Title must contain one of these |
| `EXCLUDE` | Title must contain none of these |
| `TERMS` | e.g. `Summer 2027`; empty = any |
| `LOCATIONS` | Substring match; empty = anywhere |
| `MAX_AGE_DAYS` | Ignore listings older than this |

`EXCLUDE` is what keeps the channel usable. Add to it aggressively.

## Alert colors

The bar on the left of each embed shows how old the posting is:

- 🟢 Green — under 24h
- 🟡 Amber — 1–3 days
- ⚪ Grey — older, or no date available

Thresholds live in `freshness_color()`.

## Troubleshooting

**Push fails with 403** — workflow permissions are read-only. See setup step 3.

**Runs green but nothing posts** — `WEBHOOK_URL` secret missing or misnamed.

**Duplicate alerts** — `seen.json` isn't being committed. Check the "Save state" step.

**`CERTIFICATE_VERIFY_FAILED` locally on macOS** — run `pip3 install --upgrade certifi`. Only affects local runs; CI is unaffected.

**0 matches** — filters are too narrow, or it's the off-season. Postings ramp up August through October.

## Notes

Latency floor is roughly 1–2 hours: the upstream feed scrapes career pages hourly, so polling faster wouldn't help
