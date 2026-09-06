/* Applied page: everything ticked on the listings page, with some totals. */

(function () {
  "use strict";

  const { esc, ago, fullDate, shortDate, sourceText, ROLE_LABEL, SOURCE_LABEL, applied } = window.Site;
  const $ = (sel) => document.querySelector(sel);

  let live = null;        // id -> job currently in jobs.json, once it loads
  let liveCount = 0;

  const DAY = 86400;
  const WEEK = 7 * DAY;

  function count(items, key) {
    const m = new Map();
    for (const it of items) {
      const k = key(it);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }

  // Monday 00:00 local time for the week containing ts.
  function weekStart(ts) {
    const d = new Date(ts * 1000);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return Math.floor(d.getTime() / 1000);
  }

  function factList(title, rows, opts = {}) {
    if (!rows.length) return "";
    const body = rows.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    return `<div class="fact-group${opts.wide ? " wide" : ""}"><h2>${esc(title)}</h2>${body}</div>`;
  }

  function renderIntro(items) {
    const n = items.length;
    if (!n) {
      $("#intro").innerHTML = "Nothing marked yet. On the <a href=\"./\">listings</a> page, tick the box at the right of a row when you apply, and it will show up here.";
      return;
    }
    const first = items[items.length - 1].at;
    const last = items[0].at;
    const stillOpen = live ? items.filter((i) => i.id in live).length : null;
    let s = `You&rsquo;ve applied to ${n} ${n === 1 ? "role" : "roles"}`;
    s += n === 1 ? `, ${ago(last)}.` : `, the first ${ago(first)} and the latest ${ago(last)}.`;
    if (live) {
      s += stillOpen === n
        ? ` ${n === 1 ? "It is" : "All of them are"} still listed.`
        : ` ${stillOpen} of them ${stillOpen === 1 ? "is" : "are"} still listed; the rest have dropped off the feed.`;
      s += ` That&rsquo;s ${n} of the ${liveCount + (n - stillOpen)} roles the watcher has shown you lately.`;
    }
    $("#intro").innerHTML = s;
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
      live ? ["Still listed", items.filter((i) => i.id in live).length] : null,
      ["First application", fullDate(first)],
      ["Most recent", fullDate(items[0].at)],
    ].filter(Boolean);

    const companies = count(items, (i) => i.company).slice(0, 10);
    const roles = count(items, (i) => ROLE_LABEL[i.role] || "Other");
    const sources = count(items, (i) => i.source === "ats" ? "Company board" : (SOURCE_LABEL[i.source] || i.source));

    // Last eight weeks, including empty ones, most recent first.
    const thisWeek = weekStart(now);
    const byWeek = new Map();
    for (const i of items) byWeek.set(weekStart(i.at), (byWeek.get(weekStart(i.at)) || 0) + 1);
    const weeks = [];
    for (let k = 0; k < 8; k++) {
      const ws = thisWeek - k * WEEK;
      if (ws + WEEK < first) break;
      weeks.push([`${shortDate(ws)} – ${shortDate(ws + 6 * DAY)}`, byWeek.get(ws) || 0]);
    }

    facts.innerHTML =
      factList("Totals", totals, { wide: true }) +
      factList("By company", companies) +
      factList("By week", weeks) +
      factList("By role", roles) +
      factList("By source", sources);
    facts.hidden = false;
  }

  function renderList(items) {
    const list = $("#listings");
    $("#count").textContent = items.length ? `${items.length} ${items.length === 1 ? "application" : "applications"}, newest first` : "";
    list.innerHTML = items.map((i) => {
      const gone = live && !(i.id in live);
      const loc = (i.locations || []).slice(0, 2).join("; ");
      const parts = [i.company, loc, (i.terms || []).join(", ")].filter(Boolean).map(esc);
      if (gone) parts.push('<span class="gone">no longer listed</span>');
      const when = `Applied ${fullDate(i.at)}. Click to remove.`;
      return `<li data-id="${esc(i.id)}" class="applied">
        <span class="age" title="${esc(fullDate(i.at))}">${esc(shortDate(i.at))}</span>
        <div>
          <h3 class="title"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
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
    applied.remove(li.dataset.id);
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
      liveCount = d.jobs.length;
      render();
    })
    .catch(() => { /* stats still work without the feed */ });
})();
