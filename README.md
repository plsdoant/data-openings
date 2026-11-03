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
| Company boards | 289 hand-kept job boards in `ats.py`, plus the boards found from the feeds' links in `boards/`, hit through their public APIs: Greenhouse, Lever, Ashby, Workday, SmartRecruiters | One poll |

The hand-kept boards are a tech starter list and most of the Fortune 500,
whichever members expose a board through one of those five APIs. Every
Friday, a second workflow finds the board of each company that has posted an
analyst internship to the feeds and isn't polled yet, and opens a pull
request for it (see [Found boards](#found-boards)). A good
part of the Fortune 500 can't be reached: Amazon, Apple, UnitedHealth,
JPMorgan, American Express and many others run their careers pages on Taleo,
iCIMS, SuccessFactors, Oracle, Phenom, Eightfold, or something they built
themselves, and those are covered only by the two feeds.

Every listing is normalized to the same shape, then filtered:

1. The title must contain an `INCLUDE` word and none of the `EXCLUDE` words.
2. Company-board listings must also say intern, internship, or co-op as a
   whole word, since those boards carry every open role. "International" and
   "Internal" don't count.
3. The location must look US-based. Known foreign countries and cities are
   rejected first, then US states, state codes, major metros, and bare
   "Remote" are accepted. Anything unrecognized is dropped.
4. Listings first posted more than `MAX_AGE_DAYS` ago are ignored.

The same role often appears in more than one source, so listings are deduped
across sources. Simplify usually rewrites titles but links straight to the
company's posting, so two listings whose links point at the same Workday,
Greenhouse, Lever, Ashby, or SmartRecruiters posting are one role whatever
they're called. Otherwise listings are compared on a normalized company and
title, with season tags, requisition ids, company suffixes, and "internship"
versus "intern" stripped. A looser pass also ignores word order and trailing
state codes ("Data Analyst Intern - TX"), and lets one company name extend
the other ("Corning", "Corning Incorporated"), but only when the locations
share a state and never across two different postings. When a role is in
both a feed and the company's own board, the board copy wins so the link
goes to the original posting. Once any copy of a role has been posted, the
others aren't.

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
The company-board one names as many boards as fit under Discord's 2,000
character limit and counts the rest; the site lists them all. On a quiet run
the heartbeat edits itself in place. When roles are posted it's deleted and
re-posted below them so it stays at the bottom. Its message ids live in
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

Each row has a checkbox at the right for marking a role as applied, and the
detail panel has the same toggle. The **Applied** page lists everything
you've ticked, newest first, with a few totals and a note on which roles
have since dropped off the feed. Roles applied to somewhere the watcher
doesn't look, like LinkedIn or Handshake, can be added there by hand. A
LinkedIn or Handshake link is recognized and its job id becomes the entry's
id, so pasting the same posting twice is caught. If the role is also open on
the listings, the listing itself is ticked instead. Ticks are stored in the
browser's local storage, so they stay on the device where you made them; the
page can download them as JSON and import that file elsewhere.

The listings open on **For you**, a view shaped by a profile built in the
browser. Each listing is described by named traits read from its title,
location, term, and Simplify's degree list: its role (data science, BI,
AI/ML, ...), area, seniority, degree level, type, term, state, and company.
Next to the applied box, × marks a role Not for me and opens a short
menu of reasons beside it; picking one is optional. From applications and those passes the profile learns a smoothed
log-odds weight per trait: how much more often the trait turns up among
the roles passed on than among those applied to, each side taken as a share
of its own total so a long applied list doesn't drown out a few passes. A
pass counts half against each of the job's traits, a reason makes the traits
it names count double, a trait needs three appearances before it counts, and
feedback fades by half each month. Degree, location, and term are compared
only across feedback that has them, since older applications and roles added
by hand often don't. Once ten roles have been
passed on, listings whose weights add up low enough move to **Set aside**,
a tab beside For you, each with the reason. So does anything a rule hides.
Learned weights never go further than that: the **Profile** page lists
every trait, folded by group, with what was learned about it, takes Prefer or Hide on any of
them (or on a company or state typed in), and suggests a Hide once a trait
has been passed on four times and never applied to. **All listings** shows
everything regardless. The profile is in local storage too and goes along
with the applied list in the JSON download. Trait patterns are in
`docs/traits.js`, the model in `docs/model.js`.

There's a dark mode switch in the top bar, and a small pixel fire in the
bottom-left corner that the cursor can push around. Click it to blow it out.

## Setup

1. Create a Discord webhook: Server Settings, Integrations, Webhooks, New
   Webhook, copy the URL.
2. Add repository secrets under Settings, Secrets and variables, Actions:
   `WEBHOOK_URL` for the main channel and, optionally, `WEBHOOK_URL_ATS`.
3. Under Settings, Actions, General, set workflow permissions to **Read and
   write** so the workflow can commit state, and tick **Allow GitHub Actions
   to create and approve pull requests** so the Friday workflow can propose
   boards.
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
python3 job_bot.py --suggest-boards             # add boards for feed companies not polled yet
python3 job_bot.py --suggest-boards --dry-run   # list them, write nothing
python3 job_bot.py --suggest-boards --open-prs  # open a pull request per company (what Friday runs)
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

To find a Workday slug you don't already have, POST to
`<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/anything/jobs`: a 404 means
the tenant lives on that `wdN` and a 422 means it doesn't. Once the host is
known, `robots.txt` on it lists the real site names — pick the external
careers one. Tenants are usually the company name with no punctuation, but
often a ticker or an abbreviation instead: `msd` is Merck, `coke` is
Coca-Cola, `cat` is Caterpillar, `ngc` is Northrop Grumman.

Many companies post internships on a separate campus site that the main
board doesn't show, and `robots.txt` names it too: `University`, `Campus`,
`early_careers`, and so on. Add it as a second entry under the same tenant.

Check what a board actually returns before keeping it. Several plausible
slugs belong to someone else entirely — `greenhouse/fox` is a veterinary
clinic, `harris.wd108` is an HVAC contractor, `aa.wd105` is a New Zealand
motoring club.

If the slug doesn't title-case into the company's name, add an entry to
`_NAMES`. That name is used in embeds, on the site, and for cross-source
dedupe, so spell it the way the feeds do. Run `--check-ats` after editing.

Workday boards are too large to pull whole, so each is searched server-side
for the terms in `WORKDAY_SEARCHES`, capped at 200 results per term.
SmartRecruiters boards are paged up to 600 postings.

### Found boards

Simplify links straight to each company's posting, so the link names its
board. `--suggest-boards` reads every Simplify and Jobright listing that
passes the title and location filters, open or closed, since a company that
posted an analyst internship this season is worth watching for its next one,
and fetches each board it hasn't seen once to check it responds.

The **find boards** workflow (`.github/workflows/boards.yml`) runs it every
Friday at 16:00 UTC with `--open-prs`, which opens one pull request per
company. Each adds that company's file to `boards/`, and its description
lists the board, how many open roles it has, which of them pass your filters
now, and the feed listings that pointed to it. Merge it and the board is
polled from the next run. Close it to decline. Run the workflow from the
Actions tab to check sooner.

Found boards live one company to a file, `boards/bank-of-montreal.json` and
so on, so pull requests never conflict with each other. `ats.py` polls them
alongside `COMPANIES`, under the company name the feed uses so they dedupe
against the feed's copies. A board also in `COMPANIES` is skipped. Delete a
company's file to stop polling it.

`board_notes.json` holds the rest, committed straight to `main`:

| Section | What's in it |
|---|---|
| `proposed` | Every board offered in a pull request, with its link. Kept after the pull request is merged or closed, so a declined or deleted board isn't offered again. Remove an entry to have it offered again |
| `failed` | Boards that didn't respond, with the error. Each is tried again after `RETRY_FAILED_DAYS` (a week) |
| `unsupported` | Companies with no link to one of the five APIs, and where their links go instead: iCIMS, Taleo, Oracle Cloud, a careers site of their own, or Jobright, which never links to the posting. Nothing is done with these; the feeds still fetch their listings |

Without `--open-prs`, `--suggest-boards` writes new boards to `boards/`
directly, for running by hand.

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
broken, or delete its file if it's in `boards/`. A 410 from a Workday board
means the site name changed.

**The Friday run fails with "not permitted to create or approve pull
requests."** Tick the pull request box in setup step 3. Nothing is recorded
for a pull request that didn't open, so the next run tries again.

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

A run takes about seven minutes, nearly all of it the company boards: about
950 of them once the found boards are added, the Workday ones paged eight at
a time, twenty requests each. That's inside the cron interval, but it's the
number to watch as `boards/` grows. The Friday run takes seconds when nothing
is new, since only boards it hasn't seen are fetched. Its first pass, which
checked about 690 boards, took under five minutes.

`seen.json` stores up to three keys per listing (the source id, the dedupe
key, and the posting id from its link), plus those of any duplicates merged
into it. It's never pruned, so it grows slowly over time. `docs/jobs.json` is
rewritten in full each run and stays small.

The fire on the site is generated at load with a small fire-propagation
simulation. There are no image or sound assets in the repo.
