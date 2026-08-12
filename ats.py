"""
Direct ATS polling: Greenhouse, Lever, Ashby, Workday, SmartRecruiters.

Polls each company's public job-board API and normalizes results into the
same dict shape the Simplify feed uses, so job_bot.py can filter, dedupe,
and notify without knowing where a listing came from.

Slug = the company identifier in their careers URL:
  boards.greenhouse.io/<slug>   or  job-boards.greenhouse.io/<slug>
  jobs.lever.co/<slug>
  jobs.ashbyhq.com/<slug>
  workday: "<tenant>.<wdN>/<SiteName>" from <tenant>.<wdN>.myworkdayjobs.com/<SiteName>
  careers.smartrecruiters.com/<slug>

Workday boards are huge (thousands of postings), so we ask Workday to
search for WORKDAY_SEARCH server-side and cap pagination, then let
job_bot's INCLUDE/EXCLUDE filters do the real work.

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
    ("greenhouse", "spacex"),
    ("greenhouse", "doordashusa"),     # DoorDash
    ("greenhouse", "airbnb"),
    ("greenhouse", "lyft"),
    ("greenhouse", "pinterest"),
    ("greenhouse", "reddit"),
    ("greenhouse", "instacart"),
    ("greenhouse", "databricks"),
    ("greenhouse", "datadog"),
    ("greenhouse", "figma"),
    ("greenhouse", "stripe"),
    ("greenhouse", "coinbase"),
    # Fintech:
    ("greenhouse", "robinhood"),
    ("greenhouse", "affirm"),
    ("greenhouse", "sofi"),
    ("greenhouse", "betterment"),
    ("lever", "wealthfront"),
    # Consumer tech / SaaS:
    ("greenhouse", "cloudflare"),
    ("greenhouse", "twilio"),
    ("greenhouse", "asana"),
    ("greenhouse", "mongodb"),
    ("greenhouse", "samsara"),
    ("greenhouse", "squarespace"),
    ("greenhouse", "duolingo"),
    ("greenhouse", "discord"),
    ("greenhouse", "roblox"),
    ("greenhouse", "riotgames"),
    ("greenhouse", "heartflowinc"),    # Heartflow
    ("smartrecruiters", "westerndigital"),
    ("lever", "spotify"),
    ("lever", "tri"),                  # Toyota Research Institute
    ("ashby", "notion"),
    ("ashby", "rivianvw.tech"),        # Rivian & VW Group Technologies
    # Workday boards, verified Aug 2026:
    ("workday", "nvidia.wd5/NVIDIAExternalCareerSite"),
    ("workday", "target.wd5/targetcareers"),
    ("workday", "kla.wd1/Search"),                    # KLA
    ("workday", "zoom.wd5/Zoom"),
    ("workday", "hp.wd5/ExternalCareerSite"),
    ("workday", "intel.wd1/External"),
    ("workday", "pfizer.wd1/PfizerCareers"),
    ("workday", "mastercard.wd1/CorporateCareers"),
    ("workday", "citi.wd5/2"),                        # Citi
    ("workday", "disney.wd5/disneycareer"),
    ("workday", "cvshealth.wd1/CVS_Health_Careers"),
    ("workday", "capitalone.wd12/Capital_One"),
    ("workday", "chewy.wd5/External"),
    ("workday", "comcast.wd5/Comcast_Careers"),
    ("workday", "nike.wd1/nke"),
    ("workday", "wf.wd1/WellsFargoJobs"),             # Wells Fargo
    ("workday", "sysco.wd5/syscocareers"),
    ("workday", "swa.wd1/external"),                  # Southwest Airlines
    ("workday", "tmobile.wd1/External"),              # T-Mobile
    ("workday", "etsy.wd5/Etsy_Careers"),
    ("workday", "usaa.wd1/USAAJOBSWD"),
    ("workday", "nationwide.wd1/Nationwide_Career"),
    ("workday", "genmills.wd1/GMI_External_Careers"),   # General Mills
    ("workday", "generalmotors.wd5/Careers_GM"),        # GM
    ("workday", "expedia.wd108/search"),
    ("workday", "priceline.wd1/BookingHoldings"),       # Booking Holdings
    ("workday", "hcmportal.wd5/Search"),                # UPS
]

# Display names for the status message (slug -> friendly name).
_NAMES = {
    "spacex": "SpaceX", "doordashusa": "DoorDash", "nvidia": "NVIDIA",
    "kla": "KLA", "hp": "HP", "cvshealth": "CVS Health",
    "capitalone": "Capital One", "wf": "Wells Fargo",
    "swa": "Southwest Airlines", "citi": "Citi",
    "tmobile": "T-Mobile", "usaa": "USAA", "genmills": "General Mills",
    "generalmotors": "GM", "priceline": "Booking Holdings",
    "hcmportal": "UPS", "rivianvw": "Rivian & VW Tech",
    "sofi": "SoFi", "mongodb": "MongoDB", "riotgames": "Riot Games",
    "tri": "Toyota Research", "heartflowinc": "Heartflow",
    "westerndigital": "Western Digital",
}


def display_name(slug):
    """'hcmportal.wd5/Search' -> 'UPS'. Used for embeds and cross-source dedupe."""
    key = slug.split("/", 1)[0].split(".")[0].lower()
    return _NAMES.get(key, key.title())


def company_names(companies=None):
    """Human-readable names for every configured board, alphabetical."""
    names = {display_name(slug) for _kind, slug in (companies or COMPANIES)}
    return sorted(names, key=lambda n: n.lower())


# Server-side search terms for Workday boards (they're too big to pull whole).
# Each term is a separate query; results are deduped by id.
WORKDAY_SEARCHES = ["intern", "co-op"]
_WD_PAGE = 20      # Workday's max page size
_WD_CAP = 200      # max results per board per run

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
            "company_name": display_name(slug),
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
            "company_name": display_name(slug),
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
            "company_name": display_name(slug),
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


# SmartRecruiters gives country as an ISO-2 code. Map the common ones to real
# names so job_bot's US filter can read them — an unmapped foreign location
# just looks unknown, which that filter already rejects. Never emit a bare
# 2-letter code: "ca"/"in"/"de" would collide with US state abbreviations.
_ISO2 = {
    "us": "United States", "ca": "Canada", "mx": "Mexico", "br": "Brazil",
    "ar": "Argentina", "cl": "Chile", "co": "Colombia", "cr": "Costa Rica",
    "gb": "United Kingdom", "uk": "United Kingdom", "ie": "Ireland",
    "fr": "France", "de": "Germany", "es": "Spain", "pt": "Portugal",
    "it": "Italy", "nl": "Netherlands", "be": "Belgium", "ch": "Switzerland",
    "at": "Austria", "se": "Sweden", "no": "Norway", "dk": "Denmark",
    "fi": "Finland", "pl": "Poland", "ro": "Romania", "tr": "Turkey",
    "il": "Israel", "ae": "UAE", "sa": "Saudi Arabia", "za": "South Africa",
    "eg": "Egypt", "ng": "Nigeria", "ke": "Kenya", "in": "India",
    "cn": "China", "hk": "Hong Kong", "tw": "Taiwan", "jp": "Japan",
    "kr": "Korea", "sg": "Singapore", "my": "Malaysia", "th": "Thailand",
    "vn": "Vietnam", "ph": "Philippines", "id": "Indonesia",
    "au": "Australia", "nz": "New Zealand",
}

_SR_PAGE = 100     # SmartRecruiters' max page size
_SR_CAP = 600      # max postings per board per run


def _smartrecruiters(slug, ctx):
    out, offset, total = [], 0, _SR_CAP
    ident = slug
    while offset < min(total, _SR_CAP):
        d = _get("https://api.smartrecruiters.com/v1/companies/"
                 f"{slug}/postings?limit={_SR_PAGE}&offset={offset}", ctx)
        total = d.get("totalFound", 0)
        posts = d.get("content") or []
        if not posts:
            break
        for j in posts:
            loc = j.get("location") or {}
            ident = (j.get("company") or {}).get("identifier") or ident
            parts = [loc.get("city"), loc.get("region"),
                     _ISO2.get((loc.get("country") or "").lower())]
            where = ", ".join(p for p in parts if p)
            if loc.get("remote") and "remote" not in where.lower():
                where = f"Remote — {where}" if where else "Remote"
            out.append({
                "id": f"sr-{slug}-{j.get('id')}",
                "company_name": display_name(slug),
                "title": j.get("name", "").strip(),
                "locations": [where],
                "url": f"https://jobs.smartrecruiters.com/{ident}/{j.get('id')}",
                "date_posted": _iso_to_epoch(j.get("releasedDate")),
                "terms": [],
                "active": True,
                "is_visible": True,
                "source": f"ats:{slug}",
            })
        offset += _SR_PAGE
    return out


def _wd_posted_to_epoch(s):
    """'Posted Today' / 'Posted Yesterday' / 'Posted 7 Days Ago' -> epoch."""
    s = (s or "").lower()
    now = int(time.time())
    if "today" in s:
        return now
    if "yesterday" in s:
        return now - 86400
    for tok in s.replace("+", "").split():
        if tok.isdigit():
            return now - int(tok) * 86400
    return 0


def _workday(slug, ctx):
    host, site = slug.split("/", 1)          # "nvidia.wd5", "NVIDIAExternalCareerSite"
    tenant = host.split(".")[0]
    base = f"https://{host}.myworkdayjobs.com"
    api = f"{base}/wday/cxs/{tenant}/{site}/jobs"
    seen_ids, out = set(), []
    for term in WORKDAY_SEARCHES:
        offset, total = 0, _WD_CAP
        while offset < min(total, _WD_CAP):
            body = json.dumps({"appliedFacets": {}, "limit": _WD_PAGE,
                               "offset": offset, "searchText": term}).encode()
            req = urllib.request.Request(api, data=body, headers={
                "User-Agent": "Mozilla/5.0",
                "Content-Type": "application/json",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=_TIMEOUT, context=ctx) as r:
                d = json.loads(r.read().decode())
            total = d.get("total", 0)
            posts = d.get("jobPostings", [])
            if not posts:
                break
            for j in posts:
                path = j.get("externalPath", "")
                bullets = j.get("bulletFields") or []
                req_id = bullets[0] if bullets else path
                jid = f"wd-{tenant}-{req_id}"
                if jid in seen_ids:
                    continue
                seen_ids.add(jid)
                out.append({
                    "id": jid,
                    "company_name": display_name(slug),
                    "title": j.get("title", ""),
                    "locations": [j.get("locationsText", "")],
                    "url": f"{base}/en-US/{site}{path}",
                    "date_posted": _wd_posted_to_epoch(j.get("postedOn")),
                    "terms": [],
                    "active": True,
                    "is_visible": True,
                    "source": f"ats:{tenant}",
                })
            offset += _WD_PAGE
    return out


_FETCHERS = {"greenhouse": _greenhouse, "lever": _lever, "ashby": _ashby,
             "workday": _workday, "smartrecruiters": _smartrecruiters}


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
