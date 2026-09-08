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

To find a Workday slug you don't know: POST to
<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/anything/jobs — 404 means
the tenant lives on that wdN, 422 means it doesn't — then read the real site
names out of https://<tenant>.<wdN>.myworkdayjobs.com/robots.txt.

Verify a list with:  python3 job_bot.py --check-ats
"""

import concurrent.futures as cf
import json
import sys
import time
import urllib.request

# ---------------------------------------------------------------------------
# YOUR TARGET COMPANIES  ("ats_kind", "slug")
# Tech starter list first, then as much of the Fortune 500 as these five ATS
# APIs expose. Every slug below was serving jobs when it was added. Replace
# freely with your own targets.
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

    # -----------------------------------------------------------------------
    # Fortune 500, verified Sep 2026. Slugs were found by probing each
    # company's Workday tenant and reading the site names out of its
    # robots.txt, then confirming the board serves jobs. Companies whose
    # careers run on an ATS this module doesn't speak (Taleo, iCIMS,
    # SuccessFactors, Phenom, Eightfold, or a fully in-house site) can't be
    # polled directly and are covered only by the Simplify/Jobright feeds —
    # that's most of the top ten, including Walmart, Amazon, Apple, and
    # UnitedHealth.
    # -----------------------------------------------------------------------
    # Health care, pharma, and medical devices:
    ("workday", "mckesson.wd3/External_Careers"),
    ("workday", "cardinalhealth.wd1/EXT"),              # Cardinal Health
    ("workday", "cigna.wd5/cignacareers"),
    ("workday", "elevancehealth.wd1/ANT"),              # Elevance Health
    ("workday", "centene.wd5/Centene_External"),
    ("workday", "humana.wd5/Humana_External_Career_Site"),
    ("workday", "hcahealthcare.wd3/hcacareers"),        # HCA Healthcare
    ("workday", "msd.wd5/SearchJobs"),                  # Merck
    ("workday", "bristolmyerssquibb.wd5/BMS"),
    ("workday", "abbott.wd5/abbottcareers"),
    ("workday", "thermofisher.wd5/ThermoFisherCareers"),
    ("workday", "danaher.wd1/DanaherJobs"),
    ("workday", "gilead.wd1/gileadcareers"),
    ("workday", "amgen.wd1/Careers"),
    ("workday", "regeneron.wd1/Careers"),
    ("workday", "modernatx.wd1/M_tx"),                  # Moderna
    ("workday", "viatris.wd5/External"),
    ("workday", "organon.wd5/SearchJobs"),
    ("workday", "zoetis.wd5/zoetis"),
    ("workday", "baxter.wd1/baxter"),
    ("workday", "medtronic.wd1/MedtronicCareers"),
    ("workday", "stryker.wd1/StrykerCareers"),
    ("workday", "edwards.wd5/EdwardsCareers"),          # Edwards Lifesciences
    ("workday", "labcorp.wd1/External"),
    ("workday", "iqvia.wd1/IQVIA"),
    ("workday", "davita.wd1/DKC_External"),             # DaVita
    ("workday", "henryschein.wd1/External_Careers"),
    ("workday", "owensminor.wd1/OMCareers"),            # Owens & Minor
    # Energy, utilities, and chemicals:
    ("workday", "chevron.wd5/jobs"),
    ("workday", "mpc.wd1/MPCCareers"),                  # Marathon Petroleum
    ("workday", "conocophillips.wd1/External"),
    ("workday", "oxy.wd5/Corporate"),                   # Occidental Petroleum
    ("workday", "devonenergy.wd5/Careers"),
    ("workday", "bakerhughes.wd5/BakerHughes"),
    ("workday", "williams.wd5/External"),               # The Williams Companies
    ("workday", "oneok.wd1/ONEOK"),
    ("workday", "dow.wd1/ExternalCareers"),
    ("workday", "dupont.wd5/Jobs"),
    ("workday", "ppg.wd5/PPG_CAREERS"),
    ("workday", "ecolab.wd1/Ecolab_External"),
    ("workday", "airproducts.wd5/AP0001"),              # Air Products
    ("workday", "corteva.wd5/Corteva"),
    ("workday", "mosaic.wd5/mosaic"),
    ("workday", "alcoa.wd5/Careers"),
    ("smartrecruiters", "Celanese"),
    ("workday", "dukeenergy.wd1/Search"),
    ("workday", "aep.wd1/AEPCareerSite"),               # American Electric Power
    ("workday", "xcelenergy.wd1/External"),
    ("workday", "eversource.wd1/ExternalSite"),
    ("workday", "ameren.wd1/External"),
    # Banks, insurers, and payments:
    ("workday", "usbank.wd1/US_Bank_Careers"),          # U.S. Bank
    ("workday", "pnc.wd5/External"),
    ("workday", "truist.wd1/Careers"),
    ("workday", "statestreet.wd1/Global"),              # State Street
    ("workday", "fifththird.wd5/53careers"),            # Fifth Third
    ("workday", "regions.wd5/Regions_Careers"),
    ("workday", "mtb.wd5/MTB"),                         # M&T Bank
    ("workday", "blackrock.wd1/BlackRock_Professional"),
    ("workday", "ally.wd1/Ally"),
    ("workday", "synchronyfinancial.wd5/careers"),      # Synchrony
    ("workday", "raymondjames.wd1/RaymondJamesCareers"),
    ("workday", "ameriprise.wd5/Ameriprise"),
    ("workday", "prudential.wd3/prudential"),
    ("workday", "massmutual.wd1/MMCareers"),            # MassMutual
    ("workday", "northwesternmutual.wd5/CORPORATE-CAREERS"),
    ("workday", "guardianlife.wd5/Guardian-Life-Careers"),
    ("workday", "pacificlife.wd1/PacificLifeCareers"),
    ("workday", "aig.wd1/aig"),                         # AIG
    ("workday", "travelers.wd5/External"),
    ("workday", "thehartford.wd5/Careers_External"),    # The Hartford
    ("workday", "assurant.wd1/Assurant_Careers"),
    ("workday", "unum.wd1/External"),
    ("workday", "amfam.wd1/Careers"),                   # American Family
    ("workday", "allstate.wd5/allstate_careers"),
    ("workday", "tiaa.wd1/Search"),                     # TIAA
    ("workday", "fanniemae.wd1/FannieMaeCareers"),
    ("workday", "freddiemac.wd5/External"),
    ("workday", "visa.wd5/Visa"),
    ("workday", "fiserv.wd5/EXT"),
    ("workday", "fis.wd5/SearchJobs"),                  # FIS
    ("workday", "paypal.wd1/jobs"),
    ("workday", "spgi.wd5/SPGI_Careers"),               # S&P Global
    ("workday", "nasdaq.wd1/Global_External_Site"),
    ("greenhouse", "block"),
    # Technology and electronics:
    ("workday", "cisco.wd5/Cisco_Careers"),
    ("workday", "salesforce.wd12/External_Career_Site"),
    ("workday", "adobe.wd5/external_experienced"),
    ("workday", "broadcom.wd1/External_Career"),
    ("workday", "micron.wd1/External"),
    ("workday", "analogdevices.wd1/External"),          # Analog Devices
    ("workday", "amat.wd1/External"),                   # Applied Materials
    ("workday", "hpe.wd5/Jobsathpe"),                   # HPE
    ("workday", "kyndryl.wd5/KyndrylProfessionalCareers"),
    ("workday", "dxctechnology.wd1/DXCJobs"),           # DXC Technology
    ("workday", "jabil.wd5/Jabil_Careers"),
    ("workday", "flextronics.wd1/Careers"),             # Flex
    ("workday", "arrow.wd1/AC"),                        # Arrow Electronics
    ("workday", "avnet.wd1/External"),
    ("workday", "cdw.wd5/Careers"),                     # CDW
    ("workday", "motorolasolutions.wd5/Careers"),
    ("workday", "synnex.wd5/tdsynnexcareers"),          # TD SYNNEX
    ("workday", "netflix.wd108/Netflix"),
    ("workday", "paloaltonetworks.wd5/panwexternalcareers"),
    # Aerospace, defense, and industrials:
    ("workday", "boeing.wd1/EXTERNAL_CAREERS"),
    ("workday", "ngc.wd1/Northrop_Grumman_External_Site"),   # Northrop Grumman
    ("workday", "gdit.wd5/External_Career_Site"),       # General Dynamics IT
    ("workday", "leidos.wd5/External"),
    ("workday", "caci.wd1/External"),                   # CACI
    ("workday", "bah.wd1/BAH_Jobs"),                    # Booz Allen Hamilton
    ("workday", "kbr.wd5/KBR_Careers"),                 # KBR
    ("workday", "geaerospace.wd5/GE_ExternalSite"),     # GE Aerospace
    ("workday", "gevernova.wd5/Vernova_ExternalSite"),  # GE Vernova
    ("workday", "cat.wd5/CaterpillarCareers"),          # Caterpillar
    ("workday", "itw.wd5/External"),                    # Illinois Tool Works
    ("workday", "rockwellautomation.wd1/External_Rockwell_Automation"),
    ("workday", "3m.wd1/Search"),                       # 3M
    ("workday", "carrier.wd5/jobs"),
    ("workday", "tranetechnologies.wd12/Trane_Technologies_Careers"),
    ("workday", "jci.wd5/JCI"),                         # Johnson Controls
    ("workday", "dover.wd103/Dover"),
    ("workday", "xylem.wd5/xylem-careers"),
    ("workday", "sbdinc.wd1/Stanley_Black_Decker_Career_Site"),
    ("workday", "masco.wd1/Masco"),
    # Retail, food, and consumer:
    ("workday", "homedepot.wd5/CareerDepot"),           # Home Depot
    ("workday", "lowes.wd5/LWS_External_CS"),           # Lowe's
    ("workday", "tjx.wd1/TJX_EXTERNAL"),                # TJX
    ("workday", "dollartree.wd5/dollartreeus"),         # Dollar Tree
    ("workday", "gapinc.wd1/GAPINC"),                   # Gap
    ("workday", "carmax.wd1/External"),                 # CarMax
    ("workday", "autonation.wd5/Careers"),
    ("workday", "oreillyauto.wd1/oreilly"),             # O'Reilly Auto Parts
    ("workday", "dickssportinggoods.wd1/DSG"),          # Dick's Sporting Goods
    ("greenhouse", "carvana"),
    ("workday", "pg.wd5/1000"),                         # Procter & Gamble
    ("workday", "kimberlyclark.wd1/GLOBAL"),            # Kimberly-Clark
    ("workday", "coke.wd1/coca-cola-careers"),          # Coca-Cola
    ("workday", "tysonfoods.wd5/TSN"),                  # Tyson Foods
    ("workday", "smucker.wd5/US_External_Careers"),     # J.M. Smucker
    ("workday", "chipotle.wd5/ChipotleCareers"),
    ("workday", "mgmresorts.wd5/MGMCareers"),           # MGM Resorts
    ("workday", "usfoods.wd1/usfoodscareersExternal"),  # US Foods
    ("workday", "pfg.wd3/PFGCareers"),                  # Performance Food Group
    ("workday", "ferguson.wd1/Ferguson_Experienced"),
    # Telecom, media, transport, and services:
    ("workday", "verizon.wd12/verizon-careers"),
    ("workday", "att.wd1/ATTGeneral"),                  # AT&T
    ("workday", "warnerbros.wd5/global"),               # Warner Bros. Discovery
    ("workday", "interpublic.wd5/OMC"),                 # Omnicom
    ("workday", "chrobinson.wd5/CHRobinson"),           # C.H. Robinson
    ("workday", "ryder.wd5/RyderCareers"),
    ("workday", "jll.wd1/jllcareers"),                  # JLL
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
    # Fortune 500 boards:
    "mckesson": "McKesson", "cardinalhealth": "Cardinal Health",
    "elevancehealth": "Elevance Health", "hcahealthcare": "HCA Healthcare",
    "msd": "Merck", "bristolmyerssquibb": "Bristol Myers Squibb",
    "thermofisher": "Thermo Fisher", "modernatx": "Moderna",
    "edwards": "Edwards Lifesciences", "iqvia": "IQVIA", "davita": "DaVita",
    "henryschein": "Henry Schein", "owensminor": "Owens & Minor",
    "mpc": "Marathon Petroleum", "conocophillips": "ConocoPhillips",
    "oxy": "Occidental Petroleum", "devonenergy": "Devon Energy",
    "bakerhughes": "Baker Hughes", "williams": "Williams", "oneok": "ONEOK",
    "dupont": "DuPont", "ppg": "PPG", "airproducts": "Air Products",
    "dukeenergy": "Duke Energy", "aep": "American Electric Power",
    "xcelenergy": "Xcel Energy",
    "usbank": "U.S. Bank", "pnc": "PNC", "statestreet": "State Street",
    "fifththird": "Fifth Third", "regions": "Regions Bank", "mtb": "M&T Bank",
    "blackrock": "BlackRock", "synchronyfinancial": "Synchrony",
    "raymondjames": "Raymond James", "massmutual": "MassMutual",
    "northwesternmutual": "Northwestern Mutual",
    "guardianlife": "Guardian Life", "pacificlife": "Pacific Life",
    "aig": "AIG", "thehartford": "The Hartford", "amfam": "American Family",
    "tiaa": "TIAA", "fanniemae": "Fannie Mae", "freddiemac": "Freddie Mac",
    "fis": "FIS", "paypal": "PayPal", "spgi": "S&P Global",
    "nasdaq": "Nasdaq",
    "analogdevices": "Analog Devices", "amat": "Applied Materials",
    "hpe": "HPE", "dxctechnology": "DXC Technology", "flextronics": "Flex",
    "arrow": "Arrow Electronics", "cdw": "CDW",
    "motorolasolutions": "Motorola Solutions", "synnex": "TD SYNNEX",
    "paloaltonetworks": "Palo Alto Networks",
    "ngc": "Northrop Grumman", "gdit": "General Dynamics IT", "caci": "CACI",
    "bah": "Booz Allen Hamilton", "kbr": "KBR", "geaerospace": "GE Aerospace",
    "gevernova": "GE Vernova", "cat": "Caterpillar",
    "itw": "Illinois Tool Works",
    "rockwellautomation": "Rockwell Automation",
    "tranetechnologies": "Trane Technologies", "jci": "Johnson Controls",
    "sbdinc": "Stanley Black & Decker",
    "homedepot": "Home Depot", "lowes": "Lowe's", "tjx": "TJX",
    "dollartree": "Dollar Tree", "gapinc": "Gap", "carmax": "CarMax",
    "autonation": "AutoNation", "oreillyauto": "O'Reilly Auto Parts",
    "dickssportinggoods": "Dick's Sporting Goods",
    "pg": "Procter & Gamble", "kimberlyclark": "Kimberly-Clark",
    "coke": "Coca-Cola", "tysonfoods": "Tyson Foods",
    "smucker": "J.M. Smucker", "mgmresorts": "MGM Resorts",
    "usfoods": "US Foods", "pfg": "Performance Food Group",
    "att": "AT&T", "warnerbros": "Warner Bros. Discovery",
    "interpublic": "Omnicom", "chrobinson": "C.H. Robinson", "jll": "JLL",
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
