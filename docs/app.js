/* Data Openings — renders docs/jobs.json, which the watcher rewrites every run. */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const form = $("#filters");
  const list = $("#listings");
  const detail = $("#detail");
  const detailBody = $("#detail-body");

  let data = { jobs: [] };
  let selectedId = null;

  // --- helpers ---------------------------------------------------------

  const SOURCE_LABEL = { simplify: "Simplify", jobright: "Jobright", ats: "Company board" };
  const SOURCE_URL = {
    simplify: "https://github.com/SimplifyJobs/Summer2027-Internships",
    jobright: "https://github.com/jobright-ai/2026-Data-Analysis-Internship",
  };

  const STATE_RE = /\b(A[LKZR]|C[AOT]|DE|DC|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])\b/g;
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, DC",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };
  const METRO_STATE = [
    [/\bnyc\b|new york city|manhattan|brooklyn/i, "NY"],
    [/san francisco|bay area|palo alto|mountain view|sunnyvale|santa clara|cupertino|san jose|los angeles|san diego/i, "CA"],
    [/\bseattle\b|redmond|bellevue/i, "WA"],
    [/\bboston\b|cambridge/i, "MA"],
    [/\bchicago\b/i, "IL"],
    [/\baustin\b|\bdallas\b|\bhouston\b/i, "TX"],
    [/\batlanta\b/i, "GA"],
    [/\bdenver\b/i, "CO"],
    [/\bmiami\b|\borlando\b|\btampa\b/i, "FL"],
    [/philadelphia|pittsburgh/i, "PA"],
    [/\bphoenix\b/i, "AZ"],
    [/mclean|reston|arlington/i, "VA"],
    [/bethesda/i, "MD"],
  ];

  function regionsOf(job) {
    const out = new Set();
    for (const loc of job.locations) {
      if (/remote/i.test(loc)) out.add("Remote");
      const codes = loc.match(STATE_RE);
      if (codes) codes.forEach((c) => out.add(STATE_NAMES[c]));
      else {
        for (const [re, st] of METRO_STATE) if (re.test(loc)) { out.add(STATE_NAMES[st]); break; }
      }
    }
    if (!out.size) out.add("United States");
    return [...out];
  }

  function roleOf(job) {
    const t = job.title.toLowerCase();
    if (/data scien|scientist/.test(t)) return "science";
    if (/data engineer|engineering|data platform|\betl\b|pipeline|warehouse/.test(t)) return "engineering";
    if (/business intelligence|\bbi\b|power bi|business analy|reporting|insights/.test(t)) return "bi";
    if (/analy/.test(t) || /\bdata\b/.test(t)) return "analyst";
    return "other";
  }

  function ago(ts) {
    if (!ts) return "";
    const s = Date.now() / 1000 - ts;
    if (s < 3600) return s < 300 ? "just now" : Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    const d = Math.floor(s / 86400);
    if (d < 14) return d + (d === 1 ? " day ago" : " days ago");
    return Math.floor(d / 7) + "w ago";
  }

  function shortAgo(ts) {
    if (!ts) return "—";
    const s = Date.now() / 1000 - ts;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function fullDate(ts) {
    if (!ts) return "unknown";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function sourceText(job) {
    if (job.source === "ats") return job.board ? "Direct · " + job.board : "Direct";
    return SOURCE_LABEL[job.source] || job.source;
  }

  // --- filters ---------------------------------------------------------

  function fillSelect(name, values, fmt) {
    const sel = form.elements[name];
    const keep = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = fmt ? fmt(v) : v;
      sel.appendChild(o);
    }
    sel.value = values.includes(keep) ? keep : "";
  }

  function buildFilters() {
    const companies = new Map();
    const regions = new Map();
    const terms = new Map();
    for (const j of data.jobs) {
      companies.set(j.company, (companies.get(j.company) || 0) + 1);
      for (const r of j.regions) regions.set(r, (regions.get(r) || 0) + 1);
      for (const t of j.terms) terms.set(t, (terms.get(t) || 0) + 1);
    }
    const alpha = (m) => [...m.keys()].sort((a, b) => a.localeCompare(b));
    fillSelect("company", alpha(companies), (c) => companies.get(c) > 1 ? `${c} (${companies.get(c)})` : c);
    const regs = alpha(regions).filter((r) => r !== "Remote" && r !== "United States");
    if (regions.has("Remote")) regs.unshift("Remote");
    if (regions.has("United States")) regs.push("United States");
    fillSelect("location", regs, (r) => `${r} (${regions.get(r)})`);
    fillSelect("term", alpha(terms));
  }

  function currentFilters() {
    const f = new FormData(form);
    const o = {};
    for (const [k, v] of f) o[k] = v.trim();
    return o;
  }

  function apply() {
    const f = currentFilters();
    const q = f.q.toLowerCase();
    const cutoff = f.age ? Date.now() / 1000 - Number(f.age) * 86400 : 0;

    let rows = data.jobs.filter((j) =>
      (!f.role || j.role === f.role) &&
      (!cutoff || j.posted >= cutoff) &&
      (!f.source || j.source === f.source) &&
      (!f.company || j.company === f.company) &&
      (!f.location || j.regions.includes(f.location)) &&
      (!f.term || j.terms.includes(f.term)) &&
      (!q || j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q))
    );

    const by = {
      newest: (a, b) => b.posted - a.posted,
      oldest: (a, b) => a.posted - b.posted,
      found: (a, b) => b.first_seen - a.first_seen || b.posted - a.posted,
      company: (a, b) => a.company.localeCompare(b.company) || b.posted - a.posted,
    }[f.sort || "newest"];
    rows.sort(by);

    const active = Object.entries(f).some(([k, v]) => v && k !== "sort");
    renderCount(rows.length, active);
    renderList(rows);
    writeHash();
  }

  function renderCount(n, active) {
    const total = data.jobs.length;
    const label = n === total ? `${total} listings` : `${n} of ${total} listings`;
    $("#count").innerHTML = esc(label) + (active ? ' <button type="button" id="clear">Clear filters</button>' : "");
    const clear = $("#clear");
    if (clear) clear.addEventListener("click", () => { form.reset(); apply(); });
  }

  // --- listing rows ----------------------------------------------------

  function renderList(rows) {
    if (!rows.length) {
      list.innerHTML = '<li class="empty">Nothing matches these filters.</li>';
      return;
    }
    const day = Date.now() / 1000 - 86400;
    list.innerHTML = rows.map((j) => {
      const loc = j.locations.slice(0, 2).join("; ") + (j.locations.length > 2 ? ` +${j.locations.length - 2}` : "");
      const parts = [j.company, loc, j.terms.join(", ")].filter(Boolean).map(esc);
      return `<li data-id="${esc(j.id)}"${j.id === selectedId ? ' class="selected"' : ""}>
        <span class="age${j.posted >= day ? " fresh" : ""}" title="${esc(fullDate(j.posted))}">${shortAgo(j.posted)}</span>
        <div>
          <h3 class="title">${esc(j.title)}</h3>
          <div class="meta">${parts.join('<span class="sep">·</span>')}</div>
        </div>
        <span class="source">${esc(sourceText(j))}</span>
      </li>`;
    }).join("");
  }

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) open(li.dataset.id);
  });

  // --- detail panel ----------------------------------------------------

  function open(id) {
    const j = data.jobs.find((x) => x.id === id);
    if (!j) return;
    selectedId = id;
    for (const li of list.children) li.classList.toggle("selected", li.dataset.id === id);

    const others = data.jobs.filter((x) => x.company === j.company && x.id !== j.id);
    const sourceLine = j.source === "ats"
      ? `${j.company}&rsquo;s ${esc(j.board || "job board")}, polled directly`
      : `<a href="${SOURCE_URL[j.source]}">${SOURCE_LABEL[j.source]}</a> internship list`;

    const rows = [
      ["Location", j.locations.map(esc).join("<br>") || "Not listed"],
      ["Term", j.terms.length ? esc(j.terms.join(", ")) : "Not tagged"],
      ["Posted", `${fullDate(j.posted)} <span class="when">${ago(j.posted)}</span>`],
      j.updated && j.updated - j.posted > 3600
        ? ["Last updated", `${fullDate(j.updated)} <span class="when">${ago(j.updated)}</span>`] : null,
      ["Noticed by the watcher", `${fullDate(j.first_seen)} <span class="when">${ago(j.first_seen)}</span>`],
      ["Source", sourceLine],
      j.category ? ["Category", esc(j.category)] : null,
      j.degrees && j.degrees.length ? ["Degree", esc(j.degrees.join(", "))] : null,
      j.sponsorship && j.sponsorship !== "Other" ? ["Sponsorship", esc(j.sponsorship)] : null,
    ].filter(Boolean);

    detailBody.innerHTML = `
      <p class="kicker">${esc(sourceText(j))}</p>
      <h2>${esc(j.title)}</h2>
      <p class="company">${esc(j.company)}</p>
      <a class="apply" href="${esc(j.url)}" target="_blank" rel="noopener">Apply</a>
      ${j.company_url ? `<a class="also" href="${esc(j.company_url)}" target="_blank" rel="noopener">Company on Simplify</a>` : ""}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${others.length ? `<div class="more"><h3>Also at ${esc(j.company)}</h3><ul>${
        others.map((o) => `<li data-id="${esc(o.id)}">${esc(o.title)}<span class="where">${esc(o.locations[0] || "")}</span></li>`).join("")
      }</ul></div>` : ""}
      <p class="note">The watcher keeps only the listing metadata each board exposes. The full description and requirements are on the posting itself.</p>
    `;
    detail.hidden = false;
    detail.scrollTop = 0;
    document.body.classList.add("has-detail");
    writeHash();
  }

  function close() {
    selectedId = null;
    detail.hidden = true;
    document.body.classList.remove("has-detail");
    for (const li of list.children) li.classList.remove("selected");
    writeHash();
  }

  $("#close").addEventListener("click", close);
  detailBody.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) {
      open(li.dataset.id);
      const row = list.querySelector(`li[data-id="${CSS.escape(li.dataset.id)}"]`);
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !detail.hidden) close();
  });

  // --- url state: filters and open listing survive a reload / share ----

  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(currentFilters())) {
      if (v && !(k === "sort" && v === "newest")) p.set(k, v);
    }
    if (selectedId) p.set("job", selectedId);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const el of form.elements) {
      if (el.name && p.has(el.name)) el.value = p.get(el.name);
    }
    return p.get("job");
  }

  // --- header ----------------------------------------------------------

  function renderIntro() {
    const n = data.jobs.length;
    const s = data.scanned || {};
    const age = Date.now() / 1000 - data.generated_at;
    const stale = age > 3 * 3600
      ? ` <span class="stale">The watcher hasn&rsquo;t reported in ${ago(data.generated_at).replace(" ago", "")}, so this may be behind.</span>`
      : "";
    $("#intro").innerHTML =
      `Last checked ${ago(data.generated_at)}.${stale}`;
    $("#board-count").textContent = s.boards || "";
    $("#board-list").textContent = (data.companies_polled || []).join(", ") + ".";
  }

  // --- theme -----------------------------------------------------------

  const themeBtn = $("#theme");
  const systemDark = matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function labelTheme() {
    themeBtn.textContent = currentTheme() === "dark" ? "Light" : "Dark";
  }

  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
    labelTheme();
  });
  systemDark.addEventListener("change", labelTheme);
  labelTheme();

  // --- back to top -----------------------------------------------------

  const toTop = $("#to-top");
  function checkScroll() { toTop.hidden = scrollY < 600; }
  addEventListener("scroll", checkScroll, { passive: true });
  toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  checkScroll();

  // --- boot ------------------------------------------------------------

  form.addEventListener("input", apply);
  form.addEventListener("submit", (e) => e.preventDefault());

  fetch("jobs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      data = d;
      for (const j of data.jobs) {
        j.regions = regionsOf(j);
        j.role = roleOf(j);
      }
      renderIntro();
      buildFilters();
      const jobId = readHash();
      apply();
      if (jobId) open(jobId);
    })
    .catch((err) => {
      $("#intro").textContent = "Couldn't load the listings. Try again in a minute.";
      console.error(err);
    });
})();
