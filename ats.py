"""
Direct ATS polling: Greenhouse, Lever, Ashby.

Polls each company's public job-board API and normalizes results into the
same dict shape the Simplify feed uses, so job_bot.py can filter, dedupe,
and notify without knowing where a listing came from.

Slug = the company identifier in their careers URL:
  boards.greenhouse.io/<slug>   or  job-boards.greenhouse.io/<slug>
  jobs.lever.co/<slug>
  jobs.ashbyhq.com/<slug>

Verify a list with:  python3 job_bot.py --check-ats
"""

import concurrent.futures as cf
import json
import sys
import time
import urllib.request

# ---------------------------------------------------------------------------
# YOUR TARGET COMPANIES  ("ats_kind", "slug")
# Starter list pulled from live listings — every slug below was serving jobs
# as of Jul 2026. Replace freely with your own targets.
# ---------------------------------------------------------------------------
COMPANIES = [
    ("greenhouse", "cloudflare"),
    ("greenhouse", "janestreet"),
    ("greenhouse", "point72"),
    ("greenhouse", "drweng"),          # DRW
    ("greenhouse", "virtu"),
    ("greenhouse", "sharkninjaoperatingllc"),
    ("lever", "palantir"),
    ("lever", "tri"),                  # Toyota Research Institute
    ("lever", "magnetforensics"),
    ("ashby", "cohere"),
    ("ashby", "applied"),              # Applied Intuition
    ("ashby", "Perplexity"),
    ("ashby", "rivianvw"),
]

_TIMEOUT = 25


def _get(url, ssl_ctx):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT, context=ssl_ctx) as r:
        return json.loads(r.read().decode())


def _iso_to_epoch(s):
    if not s:
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except (ValueError, TypeError):
        return 0


# --- per-ATS fetchers: each returns a list of normalized job dicts ----------

def _greenhouse(slug, ctx):
    d = _get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", ctx)
    out = []
    for j in d.get("jobs", []):
        out.append({
            "id": f"gh-{slug}-{j['id']}",
            "company_name": slug,
            "title": j.get("title", ""),
            "locations": [j.get("location", {}).get("name", "")],
            "url": j.get("absolute_url", ""),
            "date_posted": _iso_to_epoch(j.get("first_published")
                                         or j.get("updated_at")),
            "terms": [],           # ATS boards don't tag seasons
            "active": True,
            "is_visible": True,
            "source": f"ats:{slug}",
        })
    return out


def _lever(slug, ctx):
    d = _get(f"https://api.lever.co/v0/postings/{slug}?mode=json", ctx)
    out = []
    for j in d if isinstance(d, list) else []:
        loc = (j.get("categories") or {}).get("location", "")
        out.append({
            "id": f"lv-{slug}-{j.get('id')}",
            "company_name": slug,
            "title": j.get("text", ""),
            "locations": [loc],
            "url": j.get("hostedUrl", ""),
            "date_posted": int((j.get("createdAt") or 0) / 1000),  # ms epoch
            "terms": [],
            "active": True,
            "is_visible": True,
            "source": f"ats:{slug}",
        })
    return out


def _ashby(slug, ctx):
    d = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", ctx)
    out = []
    for j in d.get("jobs", []):
        if not j.get("isListed", True):
            continue
        out.append({
            "id": f"as-{slug}-{j.get('id')}",
            "company_name": slug,
            "title": j.get("title", ""),
            "locations": [j.get("location", "")],
            "url": j.get("jobUrl") or j.get("applyUrl", ""),
            "date_posted": _iso_to_epoch(j.get("publishedAt")),
            "terms": [],
            "active": True,
            "is_visible": True,
            "source": f"ats:{slug}",
        })
    return out


_FETCHERS = {"greenhouse": _greenhouse, "lever": _lever, "ashby": _ashby}


# --- public API -------------------------------------------------------------

def fetch_ats(ssl_ctx, companies=None):
    """Fetch all configured boards in parallel. Failures are logged, not fatal."""
    companies = companies or COMPANIES
    jobs, failures = [], []

    def one(item):
        kind, slug = item
        try:
            return _FETCHERS[kind](slug, ssl_ctx), None
        except Exception as e:
            return [], (kind, slug, f"{type(e).__name__}: {e}")

    with cf.ThreadPoolExecutor(min(8, max(1, len(companies)))) as ex:
        for result, err in ex.map(one, companies):
            jobs.extend(result)
            if err:
                failures.append(err)

    for kind, slug, msg in failures:
        print(f"  WARN ats {kind}/{slug}: {msg}", file=sys.stderr)
    print(f"  fetched {len(jobs):,} from {len(companies)} ATS boards"
          f" ({len(failures)} failed)")
    return jobs


def check_ats(ssl_ctx, companies=None):
    """Verify every configured slug responds. For --check-ats."""
    companies = companies or COMPANIES
    ok = True
    for kind, slug in companies:
        try:
            n = len(_FETCHERS[kind](slug, ssl_ctx))
            print(f"    OK  {kind:<10} {slug:<28} {n} open roles")
        except Exception as e:
            ok = False
            print(f"  FAIL  {kind:<10} {slug:<28} {type(e).__name__}: {e}")
    return ok
