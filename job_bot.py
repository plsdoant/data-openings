#!/usr/bin/env python3
"""
Data analyst internship watcher.

Polls the Simplify/Pitt CSC internship feed (and optionally company ATS boards
directly), filters for roles you care about, and posts new ones to Discord/Slack.

First run:   python job_bot.py --seed     (marks everything as seen, no spam)
Every run:   python job_bot.py
Dry run:     python job_bot.py --dry-run  (prints instead of posting)
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")
WEBHOOK_KIND = os.environ.get("WEBHOOK_KIND", "discord")  # "discord" or "slack"

FEEDS = [
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
    # Same schema, different community. Uncomment for more coverage:
    # "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json",
]

# A title must contain at least one of these (case-insensitive).
INCLUDE = [
    "data analyst",
    "data analytics",
    "business analyst",
    "business intelligence",
    "analytics intern",
    "analytics co-op",
    "reporting analyst",
    "insights analyst",
    "data science",
]

# ...and none of these. Tune this — it's what keeps the noise down.
EXCLUDE = [
    "phd",
    "graduate student",
    "machine learning engineer",
    "research scientist",
    "principal",
    "senior",
    "manager",
]

# Only alert on these terms. Empty list = any term.
TERMS = ["Summer 2027", "Fall 2026", "Spring 2027"]

# Optional location filter, e.g. ["CA", "Remote", "New York"]. Empty = anywhere.
LOCATIONS = []

# Ignore anything first posted more than this many days ago. Guards against a
# feed re-flagging an old listing as active and pinging you about a stale role.
MAX_AGE_DAYS = 14

STATE_FILE = Path(__file__).parent / "seen.json"
UA = {"User-Agent": "Mozilla/5.0 (job-watcher)"}


# ---------------------------------------------------------------------------
# FETCH + FILTER
# ---------------------------------------------------------------------------

def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return json.loads(r.read().decode())


def fetch_all():
    jobs = []
    for url in FEEDS:
        try:
            data = get_json(url)
            jobs.extend(data)
            print(f"  fetched {len(data):,} from {url.split('/')[4]}")
        except Exception as e:
            print(f"  WARN: {url} failed: {e}", file=sys.stderr)
    return jobs


def matches(job):
    if not (job.get("active") and job.get("is_visible", True)):
        return False

    title = (job.get("title") or "").lower()
    if not any(k in title for k in INCLUDE):
        return False
    if any(k in title for k in EXCLUDE):
        return False

    if TERMS and not any(t in job.get("terms", []) for t in TERMS):
        return False

    if LOCATIONS:
        locs = " ".join(job.get("locations") or []).lower()
        if not any(l.lower() in locs for l in LOCATIONS):
            return False

    posted = job.get("date_posted") or 0
    if posted and (time.time() - posted) > MAX_AGE_DAYS * 86400:
        return False

    return True


def job_key(job):
    """Stable identity. Falls back to company+title if the feed has no id."""
    return job.get("id") or f"{job.get('company_name')}::{job.get('title')}"


# ---------------------------------------------------------------------------
# NOTIFY
# ---------------------------------------------------------------------------

def post(payload):
    if not WEBHOOK_URL:
        print("ERROR: WEBHOOK_URL not set", file=sys.stderr)
        return False
    req = urllib.request.Request(
        WEBHOOK_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            return r.status < 300
    except Exception as e:
        print(f"ERROR posting: {e}", file=sys.stderr)
        return False


def human_age(ts):
    """'3h ago' style, for Slack and dry-run output."""
    if not ts:
        return "unknown"
    secs = time.time() - ts
    if secs < 0:
        return "just posted"
    mins = secs / 60
    if mins < 60:
        return "just posted" if mins < 5 else f"{int(mins)}m ago"
    hours = mins / 60
    if hours < 24:
        return f"{int(hours)}h ago"
    days = hours / 24
    if days < 14:
        return f"{int(days)}d ago"
    return f"{int(days / 7)}w ago"


def freshness_color(ts):
    """Green under a day, amber under three, grey beyond."""
    if not ts:
        return 0x95A5A6
    hrs = (time.time() - ts) / 3600
    return 0x2ECC71 if hrs < 24 else 0xF1C40F if hrs < 72 else 0x95A5A6


def fmt_line(job):
    loc = ", ".join((job.get("locations") or ["—"])[:3])
    terms = "/".join(job.get("terms") or [])
    return (job["company_name"], job["title"], loc, terms,
            job.get("url", ""), job.get("date_posted") or 0)


def notify_discord(jobs):
    # Discord allows 10 embeds per message.
    for i in range(0, len(jobs), 10):
        chunk = jobs[i:i + 10]
        embeds = []
        for j in chunk:
            company, title, loc, terms, url, posted = fmt_line(j)
            embeds.append({
                "title": f"{title[:200]}",
                "url": url,
                "color": freshness_color(posted),
                "fields": [
                    {"name": "Company", "value": company[:100], "inline": True},
                    {"name": "Location", "value": loc[:100], "inline": True},
                    {"name": "Term", "value": terms[:100] or "—", "inline": True},
                    {"name": "Posted", "value": (
                        f"<t:{posted}:d> — <t:{posted}:R>" if posted else "unknown"
                    ), "inline": False},
                ],
            })
        post({"content": f"**{len(chunk)} new analyst role(s)**", "embeds": embeds})
        time.sleep(1)  # stay under Discord's rate limit


def notify_slack(jobs):
    for i in range(0, len(jobs), 20):
        chunk = jobs[i:i + 20]
        lines = []
        for j in chunk:
            company, title, loc, terms, url, posted = fmt_line(j)
            lines.append(f"• <{url}|*{title}*> — {company} · {loc} · {terms}"
                         f" · _posted {human_age(posted)}_")
        post({
            "text": f"{len(chunk)} new analyst role(s)",
            "blocks": [{
                "type": "section",
                "text": {"type": "mrkdwn", "text": "\n".join(lines)[:2900]},
            }],
        })
        time.sleep(1)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", action="store_true",
                    help="mark everything currently open as seen, send nothing")
    ap.add_argument("--dry-run", action="store_true",
                    help="print matches instead of posting")
    args = ap.parse_args()

    print(f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}] polling...")
    all_jobs = fetch_all()
    hits = [j for j in all_jobs if matches(j)]
    print(f"  {len(hits)} listings match your filters")

    seen = set()
    if STATE_FILE.exists():
        seen = set(json.loads(STATE_FILE.read_text()).get("seen", []))

    fresh = [j for j in hits if job_key(j) not in seen]
    fresh.sort(key=lambda j: j.get("date_posted", 0), reverse=True)
    print(f"  {len(fresh)} are new since last run")

    if args.seed:
        STATE_FILE.write_text(json.dumps({"seen": sorted(job_key(j) for j in hits)}))
        print(f"  seeded {len(hits)} listings. Future runs alert on new ones only.")
        return

    if fresh and args.dry_run:
        for j in fresh:
            company, title, loc, terms, url, posted = fmt_line(j)
            print(f"    [{human_age(posted):>12}] {company} | {title} | {loc}")
    elif fresh:
        (notify_slack if WEBHOOK_KIND == "slack" else notify_discord)(fresh)
        print(f"  posted {len(fresh)}")

    # Persist. Keep seen keys for everything currently matching so a role that
    # briefly disappears from the feed doesn't re-alert when it comes back.
    if not args.dry_run:
        seen |= {job_key(j) for j in hits}
        STATE_FILE.write_text(json.dumps({"seen": sorted(seen)}))


if __name__ == "__main__":
    main()