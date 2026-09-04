# data-openings

A watcher for US data analyst internships. Every 30 minutes it checks three
sources, keeps the roles that look like analyst internships, posts anything
new to Discord, and publishes the current set as a small website.

Site: https://plsdoant.github.io/data-openings/

## How it works

Three sources are polled on each run:

| Source | What it is | Latency |
|---|---|---|
| Simplify | The [Summer 2027 internships](https://github.com/SimplifyJobs/Summer2027-Internships) JSON feed, ~16,000 listings | Hours to days, since it's curated by hand |
| Jobright | The [data analysis internships](https://github.com/jobright-ai/2026-Data-Analysis-Internship) README table, parsed directly because the repo publishes no JSON | About an hour |
| Company boards | 60 job boards hit through their public APIs: Greenhouse, Lever, Ashby, Workday, SmartRecruiters | One poll |

Every listing is normalized to the same shape, then filtered:

1. The title must contain an `INCLUDE` word and none of the `EXCLUDE` words.
2. Company-board listings must also say intern or co-op, since those boards
   carry every open role.
3. The location must look US-based. Known foreign countries and cities are
   rejected first, then US states, state codes, major metros, and bare
   "Remote" are accepted. Anything unrecognized is dropped.
4. Listings first posted more than `MAX_AGE_DAYS` ago are ignored.

The same role often appears in more than one source, so listings are deduped
across sources on a normalized company and title. Season tags, requisition
ids, company suffixes, and "internship" versus "intern" are all stripped
before comparing. When a role is in both a feed and the company's own board,
the board copy wins so the link goes to the original posting.

What survives is compared with `seen.json`. New roles go to Discord, then
the file is updated and committed back to the repo along with
`docs/jobs.json` for the site.

## Discord

Roles post as embeds, ten per message. The bar on the left shows the age of
the posting: green under a day, amber under three days, grey beyond that or
when no date is known.

Set `WEBHOOK_URL_ATS` and company-board finds go to their own channel while
both feeds stay in `WEBHOOK_URL`. Leave it unset and everything goes to one
channel.

Each channel has one heartbeat message that says what was checked and when.
On a quiet run it edits itself in place. When roles are posted it's deleted
and re-posted below them so it stays at the bottom. Its message ids live in
`seen.json`.

Set `WEBHOOK_KIND=slack` for a Slack incoming webhook instead. Slack hooks
can't edit messages, so the heartbeat posts plainly every run.

## Site

`docs/` is a static page served by GitHub Pages. It lists everything
currently passing the filters, newest first, with the title, company,
location, term, age, and source visible on every row. Clicking a row opens a
panel with the full details and an Apply link. Filters cover role, posting
age, source, term, location, company, and free text, and the current filter
state is kept in the URL so a view can be shared.

The page reads `docs/jobs.json`, which the bot rewrites on every run. Each
listing carries a `first_seen` stamp, kept across runs, so the page can show
when the watcher first noticed a role separately from when it was posted.
Listings drop off the page two weeks after they were posted, same as the
Discord filter.

There's a dark mode switch in the top bar, and a small pixel fire in the
bottom-left corner that the cursor can push around. Click it to blow it out.

## Setup

1. Create a Discord webhook: Server Settings, Integrations, Webhooks, New
   Webhook, copy the URL.
2. Add repository secrets under Settings, Secrets and variables, Actions:
   `WEBHOOK_URL` for the main channel and, optionally, `WEBHOOK_URL_ATS`.
3. Under Settings, Actions, General, set workflow permissions to **Read and
   write** so the workflow can commit state.
4. Under Settings, Pages, set the source to **Deploy from a branch**, branch
   `main`, folder `/docs`.
5. Seed locally so the first run doesn't post every open role:

   ```bash
   python3 job_bot.py --seed
   git add seen.json && git commit -m "seed" && git push
   ```

6. Open the Actions tab, pick **job watch**, and run it once by hand.

The only dependency is Python 3.12. `certifi` is used if installed, which
avoids certificate errors on macOS.

## Commands

```bash
python3 job_bot.py               # normal run: post new roles, update state and site data
python3 job_bot.py --dry-run     # print matches, post nothing, change nothing
python3 job_bot.py --export      # rebuild docs/jobs.json only
python3 job_bot.py --check-ats   # confirm every configured board still responds
python3 job_bot.py --test 3      # post the 3 newest matches to check formatting, state untouched
python3 job_bot.py --seed        # mark everything currently open as seen, post nothing
```

Export `WEBHOOK_URL` in your shell before anything that posts.

To preview the site, serve the folder and open http://localhost:8765:

```bash
python3 -m http.server 8765 --directory docs
```

## Configuration

Filters are at the top of `job_bot.py`:

| Setting | Meaning |
|---|---|
| `INCLUDE` | Title must contain one of these |
| `EXCLUDE` | Title must contain none of these |
| `TERMS` | Only these season tags, e.g. `Summer 2027`. Empty means any. Board listings have no tags and always pass |
| `US_ONLY` | Drop anything not clearly in the US |
| `LOCATIONS` | Substring match on location. Empty means anywhere |
| `MAX_AGE_DAYS` | Ignore listings first posted longer ago than this |

`EXCLUDE` is what keeps the channel readable. Add to it freely. If a US role
is being dropped, its location string probably isn't recognized; add it to
`_US_CITIES`.

Company boards are the `COMPANIES` list in `ats.py`. Each entry is
`("kind", "slug")`, where the slug comes from the careers URL:

| Kind | URL | Slug |
|---|---|---|
| greenhouse | `boards.greenhouse.io/spacex` | `spacex` |
| lever | `jobs.lever.co/palantir` | `palantir` |
| ashby | `jobs.ashbyhq.com/cohere` | `cohere` |
| workday | `nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` | `nvidia.wd5/NVIDIAExternalCareerSite` |
| smartrecruiters | `careers.smartrecruiters.com/westerndigital` | `westerndigital` |

If the slug doesn't title-case into the company's name, add an entry to
`_NAMES`. That name is used in embeds, on the site, and for cross-source
dedupe, so spell it the way the feeds do. Run `--check-ats` after editing.

Workday boards are too large to pull whole, so each is searched server-side
for the terms in `WORKDAY_SEARCHES`, capped at 200 results per term.
SmartRecruiters boards are paged up to 600 postings.

Feeds are `FEEDS` in `job_bot.py` and `REPOS` in `jobright.py`. Any repo
using the same JSON schema or README table works.

## Troubleshooting

**Push fails with 403.** Workflow permissions are read-only. See setup step 3.

**Runs are green but nothing posts.** The `WEBHOOK_URL` secret is missing or
misnamed.

**Duplicate alerts.** `seen.json` isn't being committed. Check the "Save
state" step in the workflow log.

**The site shows an old "last checked" time.** Pages is serving a stale
`docs/jobs.json`. Check that the workflow's save step is committing it and
that Pages is set to deploy from `/docs`.

**`CERTIFICATE_VERIFY_FAILED` locally on macOS.** Run
`pip3 install --upgrade certifi`. CI is unaffected.

**One board warns on every run.** The slug moved, or the company blocks
datacenter IPs. Confirm with `--check-ats` and delete the line if it stays
broken. A 410 from a Workday board means the site name changed.

**Zero matches.** The filters are too narrow, or it's the off-season.
Postings ramp up from August through October.

**A feed parses 0 rows.** `jobright.py` reads a markdown table, and a format
change makes it go quiet rather than fail. Check with:

```bash
python3 -c "import jobright, job_bot; print(len(jobright.fetch_jobright(job_bot.SSL_CTX)))"
```

## Notes

Feed listings have a latency floor of an hour or two because the upstream
lists are rebuilt on their own schedule. Direct board polling has no such
floor and is limited only by the 30-minute cron, which GitHub often runs
late.

`seen.json` stores two keys per listing, the source id and the dedupe key,
and is never pruned, so it grows slowly over time. `docs/jobs.json` is
rewritten in full each run and stays small.

The fire on the site is generated at load with a small fire-propagation
simulation. There are no image or sound assets in the repo.
