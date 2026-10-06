/* Applied page: everything ticked on the listings page, with some totals. */

(function () {
  "use strict";

  const { esc, fullDate, shortDate, sourceText, applied } = window.Site;
  const $ = (sel) => document.querySelector(sel);

  let live = null;        // id -> job currently in jobs.json, once it loads

  const DAY = 86400;
  const WEEK = 7 * DAY;

  function factList(title, rows, opts = {}) {
    if (!rows.length) return "";
    const body = rows.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    return `<div class="fact-group${opts.wide ? " wide" : ""}"><h2>${esc(title)}</h2>${body}</div>`;
  }

  function renderIntro(items) {
    const n = items.length;
    $("#intro").textContent = `lock in twin. ${n} applied.`;
  }

  function renderFacts(items) {
    const facts = $("#facts");
    if (!items.length) { facts.hidden = true; return; }
    const now = Date.now() / 1000;
    const first = items[items.length - 1].at;
    const weeksActive = Math.max(1, (now - first) / WEEK);

    const totals = [
      ["Total", items.length],
      ["Past 7 days", items.filter((i) => now - i.at < WEEK).length],
      ["Past 30 days", items.filter((i) => now - i.at < 30 * DAY).length],
      ["Per week, on average", (items.length / weeksActive).toFixed(1)],
      ["Companies", new Set(items.map((i) => i.company)).size],
    ];

    facts.innerHTML = factList("Totals", totals, { wide: true });
    facts.hidden = false;
  }

  function renderList(items) {
    const list = $("#listings");
    $("#count").textContent = items.length
      ? `${items.length} ${items.length === 1 ? "application" : "applications"}, newest first`
      : "Tick the box at the right of a listing when you apply, and it will show up here. Roles from LinkedIn or Handshake can be added above.";
    list.innerHTML = items.map((i) => {
      const gone = live && !i.manual && !(i.id in live);
      const loc = (i.locations || []).slice(0, 2).join("; ");
      const parts = [i.company, loc, (i.terms || []).join(", ")].filter(Boolean).map(esc);
      if (gone) parts.push('<span class="gone">no longer listed</span>');
      const when = `Applied ${fullDate(i.at)}. Click to remove.`;
      return `<li data-id="${esc(i.id)}" class="applied">
        <span class="age"><span title="Applied ${esc(fullDate(i.at))}">${esc(shortDate(i.at))}</span>${
          i.posted ? `<span class="posted" title="Posted ${esc(fullDate(i.posted))}">${esc(shortDate(i.posted))}</span>` : ""
        }</span>
        <div>
          <h3 class="title">${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</h3>
          <div class="meta">${parts.join('<span class="sep">·</span>')}</div>
        </div>
        <span class="source">${esc(sourceText(i))}</span>
        <button type="button" class="tick" aria-pressed="true" aria-label="${esc(when)}" title="${esc(when)}"></button>
      </li>`;
    }).join("");
  }

  function render() {
    const items = Object.values(applied.all()).sort((a, b) => b.at - a.at);
    renderIntro(items);
    renderFacts(items);
    renderList(items);
    $("#tools").hidden = !items.length;
  }

  // --- interactions ----------------------------------------------------

  $("#listings").addEventListener("click", (e) => {
    const btn = e.target.closest(".tick");
    if (!btn) return;
    const li = btn.closest("li[data-id]");
    const entry = applied.get(li.dataset.id);
    if (entry && entry.manual &&
        !confirm(`Remove ${entry.title} at ${entry.company}? It was added by hand, so it can't be ticked again from the listings.`)) return;
    applied.remove(li.dataset.id);
  });

  // --- adding by hand --------------------------------------------------
  // For roles applied to somewhere the watcher doesn't look. LinkedIn and
  // Handshake links carry the posting's own id, which becomes the entry's
  // id, so the same job pasted twice is caught as a repeat.

  const addForm = $("#add-form");
  const status = $("#add-status");

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36);
  }

  function parseLink(raw) {
    let s = raw.trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (!u.hostname.includes(".")) return null;
    const byUrl = "url-" + hash(u.host + u.pathname + u.search);
    if (/(^|\.)linkedin\.com$/.test(u.hostname)) {
      // /jobs/view/4012345678, /jobs/view/some-title-at-acme-4012345678,
      // or a search page with ?currentJobId=4012345678
      const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/);
      const id = m ? m[1] : u.searchParams.get("currentJobId");
      if (id && /^\d+$/.test(id)) {
        return { source: "linkedin", id: "li-" + id, url: `https://www.linkedin.com/jobs/view/${id}/` };
      }
      return { source: "linkedin", id: byUrl, url: u.href };
    }
    if (/(^|\.)joinhandshake\.com$/.test(u.hostname)) {
      // app.joinhandshake.com/jobs/123, /stu/jobs/123, /job-search/123
      const m = u.pathname.match(/\/(?:jobs|job-search)\/(\d+)/);
      return { source: "handshake", id: m ? "hs-" + m[1] : byUrl, url: u.href };
    }
    return { source: null, id: byUrl, url: u.href };
  }

  // Same normalization as dedupe_key in job_bot.py, so a role typed in by
  // hand lines up with the copy the watcher found under a slightly
  // different title.
  const CO_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|technologies|technology|usa|us|the)\b/g;
  const SEASON = /\b(summer|fall|autumn|winter|spring)\b|\b20\d\d\b|\bfy\d\d\b/g;
  const REQ_ID = /\b[a-z]?\d{4,}\b/g;

  function norm(s, extra) {
    s = (s || "").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/&/g, " and ");
    if (extra) s = extra(s);
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }

  function matchKey(job) {
    const company = norm(job.company, (s) => s.replace(CO_SUFFIXES, " ")).replace(/ /g, "");
    const title = norm(job.title, (s) => s.replace(SEASON, " ").replace(REQ_ID, " "))
      .replace(/\binternships?\b/g, "intern")
      .replace(/\b(co op|coop)\b/g, "intern");
    return company && title ? `${company}::${title}` : null;
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Today means now, so same-day entries keep their order. An earlier day
  // is pinned to noon so no timezone pushes it onto the neighbouring date.
  function appliedAt(value) {
    if (!value || value === today()) return Math.floor(Date.now() / 1000);
    const [y, m, d] = value.split("-").map(Number);
    return Math.floor(new Date(y, m - 1, d, 12) / 1000);
  }

  function say(msg) { status.textContent = msg; }

  addForm.elements.date.defaultValue = today();
  addForm.elements.date.max = today();

  addForm.addEventListener("input", (e) => {
    say("");
    if (e.target.name !== "url") return;
    const link = parseLink(e.target.value);
    const sel = addForm.elements.source;
    if (link && link.source) sel.value = link.source;
    else if (link && (sel.value === "linkedin" || sel.value === "handshake")) sel.value = "company";
  });

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = addForm.elements;
    const raw = f.url.value.trim();
    const link = parseLink(raw);
    if (raw && !link) { say("That link doesn't look right."); f.url.focus(); return; }

    const job = {
      id: link ? link.id : "manual-" + Date.now().toString(36),
      title: f.title.value.trim(),
      company: f.company.value.trim(),
      url: link ? link.url : "",
      locations: f.location.value.trim() ? [f.location.value.trim()] : [],
      source: f.source.value,
      manual: true,
    };

    const same = applied.get(job.id);
    if (same) { say(`Already on your list, applied ${fullDate(same.at)}.`); return; }

    // The same role under another link: likely a repeat, but two postings
    // can share a title at one company, so ask rather than refuse.
    const key = matchKey(job);
    const near = key && Object.values(applied.all()).find((a) => matchKey(a) === key);
    if (near && !confirm(`${near.title} at ${near.company} is already on your list, applied ${fullDate(near.at)}. Add this one as well?`)) return;

    // Still open in the feed: tick that listing instead, so it shows as
    // applied on the listings page too.
    const listed = !near && key && live && Object.values(live).find((j) => matchKey(j) === key);

    applied.add(listed || job, appliedAt(f.date.value));
    addForm.reset();
    say(listed ? `Added. It's open on the listings too, so it's ticked there.` : `Added ${job.title} at ${job.company}.`);
    f.url.focus();
  });

  $("#export").addEventListener("click", () => {
    const items = Object.values(applied.all()).sort((a, b) => b.at - a.at);
    const blob = new Blob([JSON.stringify({ exported_at: Math.floor(Date.now() / 1000), applied: items }, null, 2)],
                          { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `applied-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((text) => {
      let parsed;
      try { parsed = JSON.parse(text); } catch (err) { alert("That file isn't JSON."); return; }
      const entries = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.applied) ? parsed.applied
        : parsed && typeof parsed === "object" ? Object.values(parsed) : [];
      const added = applied.merge(entries);
      alert(added ? `Added ${added} ${added === 1 ? "application" : "applications"}.` : "Nothing new in that file.");
      e.target.value = "";
    });
  });

  $("#clear-all").addEventListener("click", () => {
    const n = applied.count();
    if (n && confirm(`Remove all ${n} applications from this browser? Download a copy first if you want to keep them.`)) {
      applied.clear();
    }
  });

  addEventListener("applied-change", render);

  // --- boot ------------------------------------------------------------

  render();
  fetch("jobs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      live = {};
      for (const j of d.jobs) live[j.id] = j;
      render();
    })
    .catch(() => { /* stats still work without the feed */ });
})();
