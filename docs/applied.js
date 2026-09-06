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
      : "Tick the box at the right of a listing when you apply, and it will show up here.";
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
      render();
    })
    .catch(() => { /* stats still work without the feed */ });
})();
