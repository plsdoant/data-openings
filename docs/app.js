/* Data Openings — renders docs/jobs.json, which the watcher rewrites every run. */

(function () {
  "use strict";

  const {
    esc, ago, fullDate, roleOf, regionsOf, sourceText, SOURCE_LABEL, SOURCE_URL,
    applied, dismissed, profile, traitsOf, traitLabel, REASONS,
  } = window.Site;

  const $ = (sel) => document.querySelector(sel);
  const form = $("#filters");
  const list = $("#listings");
  const detail = $("#detail");
  const detailBody = $("#detail-body");
  const views = $("#views");

  let data = { jobs: [] };
  let selectedId = null;
  let view = "foryou";         // "aside": what the profile set aside; "all": every listing, profile ignored
  let model = null;            // refitted on every apply()
  let last = { rows: null, aside: 0, active: false };

  function shortAgo(ts) {
    if (!ts) return "—";
    const s = Date.now() / 1000 - ts;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
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
    const done = applied.all();
    const passed = dismissed.all();
    const status = {
      open: (j) => !(j.id in done),
      applied: (j) => j.id in done,
      passed: (j) => j.id in passed,
    }[f.status];

    let rows = data.jobs.filter((j) =>
      (!f.role || j.role === f.role) &&
      (!cutoff || j.posted >= cutoff) &&
      (!f.source || j.source === f.source) &&
      (!f.company || j.company === f.company) &&
      (!f.location || j.regions.includes(f.location)) &&
      (!f.term || j.terms.includes(f.term)) &&
      (!status || status(j)) &&
      (!q || j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q))
    );

    model = profile.fit();
    for (const j of rows) {
      j.judge = profile.judge(j, model);
      // Something you applied to stays in view whatever the profile says.
      j.group = j.id in done || j.judge.verdict === "shown" ? "shown" : "aside";
    }

    const by = {
      newest: (a, b) => b.posted - a.posted,
      oldest: (a, b) => a.posted - b.posted,
      found: (a, b) => b.first_seen - a.first_seen || b.posted - a.posted,
      company: (a, b) => a.company.localeCompare(b.company) || b.posted - a.posted,
      match: (a, b) => b.judge.score - a.judge.score || b.posted - a.posted,
    }[f.sort || "newest"];
    rows.sort(by);

    // Roles you passed on leave "For you" and "Set aside", unless that's
    // what you asked to see.
    const kept = f.status === "passed" ? rows : rows.filter((j) => !(j.id in passed));
    const aside = kept.filter((j) => j.group === "aside");
    const shown = view === "all" ? rows : view === "aside" ? aside : kept.filter((j) => j.group === "shown");

    closeWhy();
    last = { rows: shown, aside: aside.length, active: Object.entries(f).some(([k, v]) => v && k !== "sort") };
    renderViews();
    renderCount();
    renderList(shown, done, passed);
    writeHash();
  }

  function renderCount() {
    const { rows, active } = last;
    if (!rows) return;
    const done = applied.all();
    const n = rows.length;
    const total = data.jobs.length;
    let label;
    if (view === "all") label = n === total ? `${total} listings` : `${n} of ${total} listings`;
    else if (view === "aside") label = `${n} set aside`;
    else {
      label = `${n} for you`;
      const empty = !model.active && !Object.keys(model.rules).length;
      if (empty && !active) label += " · nothing filtered yet";
    }
    const appliedHere = rows.filter((j) => j.id in done).length;
    if (appliedHere) label += ` · ${appliedHere} applied`;
    $("#count").innerHTML = esc(label) + (active ? ' <button type="button" id="clear">Clear filters</button>' : "");
    const clear = $("#clear");
    if (clear) clear.addEventListener("click", () => { form.reset(); apply(); });
  }

  // --- listing rows ----------------------------------------------------

  function tick(job, done) {
    const on = job.id in done;
    const title = on ? `Applied ${ago(done[job.id].at)}. Click to undo.` : "Mark as applied";
    return `<button type="button" class="tick" aria-pressed="${on}" aria-label="${esc(title)}" title="${esc(title)}"></button>`;
  }

  // The × beside the tick. Not offered on something you've applied to.
  function passButton(job, done, passed) {
    if (job.id in done) return "<span></span>";
    const on = job.id in passed;
    const title = on ? "Not for me. Click to undo." : "Not for me";
    return `<button type="button" class="pass" aria-pressed="${on}" aria-label="${title}" title="${title}">&times;</button>`;
  }

  function passedHTML(entry) {
    const reason = entry.reason && profile.REASON[entry.reason];
    const sep = '<span class="sep">·</span>';
    return `Not for me${sep}${reason ? esc(reason.label) : '<button type="button" class="add-reason">Add a reason</button>'}` +
      `${sep}<button type="button" class="undo">Undo</button>`;
  }

  function whyHTML(j, passed) {
    if (j.id in passed) return `<div class="why">${passedHTML(passed[j.id])}</div>`;
    if (view === "aside") return `<div class="why">${esc(profile.explain(j.judge, model))}</div>`;
    return "";
  }

  const day = () => Date.now() / 1000 - 86400;

  function row(j, done, passed) {
    const loc = j.locations.slice(0, 2).join("; ") + (j.locations.length > 2 ? ` +${j.locations.length - 2}` : "");
    const parts = [j.company, loc, j.terms.join(", ")].filter(Boolean).map(esc);
    const cls = [
      j.id === selectedId ? "selected" : "",
      j.id in done ? "applied" : "",
      j.id in passed ? "passed" : "",
    ].filter(Boolean).join(" ");
    return `<li data-id="${esc(j.id)}"${cls ? ` class="${cls}"` : ""}>
      <span class="age${j.posted >= day() ? " fresh" : ""}" title="${esc(fullDate(j.posted))}">${shortAgo(j.posted)}</span>
      <div>
        <h3 class="title">${esc(j.title)}</h3>
        <div class="meta">${parts.join('<span class="sep">·</span>')}</div>
        ${whyHTML(j, passed)}
      </div>
      <span class="source">${esc(sourceText(j))}</span>
      ${passButton(j, done, passed)}
      ${tick(j, done)}
    </li>`;
  }

  function renderList(rows, done, passed) {
    if (!rows.length) {
      const msg = view === "all" ? "Nothing matches these filters."
        : view === "foryou" ? "Nothing for you matches these filters."
        : last.active ? "Nothing set aside matches these filters."
        : `Nothing set aside. Listings your rules hide land here, and once you&rsquo;ve passed on ${profile.MIN_PASSED} roles, so do ones you&rsquo;d likely skip.`;
      list.innerHTML = `<li class="empty">${msg}</li>`;
      return;
    }
    list.innerHTML = rows.map((j) => row(j, done, passed)).join("");
  }

  // Redraw one row in place so the list doesn't jump. A status filter is
  // the one case where the row may need to leave, so that re-runs the filter.
  function refresh(id) {
    if (form.elements.status.value) apply();
    else {
      const j = data.jobs.find((x) => x.id === id);
      const li = list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
      if (j && li) li.outerHTML = row(j, applied.all(), dismissed.all());
      renderCount();
    }
    if (selectedId === id) open(id);
  }

  function toggleApplied(id) {
    const j = data.jobs.find((x) => x.id === id);
    if (!j) return;
    if (dismissed.has(id)) dismissed.remove(id);
    applied.toggle(j);
    refresh(id);
  }

  // A passed row stays put until the next filter change or reload takes it
  // out of view, and the reasons open beside the × that was clicked.
  function togglePassed(id, from) {
    const j = data.jobs.find((x) => x.id === id);
    if (!j) return;
    if (dismissed.has(id)) { dismissed.remove(id); refresh(id); return; }
    dismissed.add(j);
    refresh(id);
    const anchor = from === "panel" ? $("#pass") : list.querySelector(`li[data-id="${CSS.escape(id)}"] .pass`);
    if (anchor) askWhy(id, anchor);
  }

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest(".tick")) toggleApplied(id);
    else if (e.target.closest(".pass, .undo")) togglePassed(id, "row");
    else if (e.target.closest(".add-reason")) askWhy(id, e.target.closest(".add-reason"));
    else open(id);
  });

  views.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    apply();
  });

  function renderViews() {
    for (const b of views.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", b.dataset.view === view);
    $("#aside-count").textContent = last.aside ? ` (${last.aside})` : "";
  }

  // --- why not: the reasons menu ---------------------------------------
  // Opens just right of the × you clicked, so a reason is one short move
  // away. Clicking anywhere else keeps the pass without one.

  const pop = $("#reasons");
  pop.innerHTML = `<p>Why not?</p>` +
    REASONS.map(([k, label]) => `<button type="button" data-reason="${k}">${esc(label)}</button>`).join("");
  let popFor = null;
  let popAnchor = null;

  function askWhy(id, anchor) {
    popFor = id;
    popAnchor = anchor;
    // The panel doesn't scroll with the page, so a menu opened from it
    // shouldn't either.
    const fixed = !!anchor.closest(".detail");
    pop.style.position = fixed ? "fixed" : "absolute";
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    // In a row, clear the applied box so it stays clickable.
    const tickBox = anchor.closest("li[data-id]") && anchor.closest("li[data-id]").querySelector(".tick");
    let left = (tickBox && anchor.classList.contains("pass") ? tickBox.getBoundingClientRect().right : r.right) + 12;
    let top = r.top - 8;
    // No room on the right (a phone, or the panel's edge): drop below instead.
    if (left + w > innerWidth - 12) { left = Math.max(12, r.right - w); top = r.bottom + 8; }
    top = Math.max(12, Math.min(top, innerHeight - h - 12));
    pop.style.left = (fixed ? left : left + scrollX) + "px";
    pop.style.top = (fixed ? top : top + scrollY) + "px";
    pop.querySelector("button").focus({ preventScroll: true });
  }

  function closeWhy(refocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    if (refocus && popAnchor && popAnchor.isConnected) popAnchor.focus({ preventScroll: true });
    popFor = popAnchor = null;
  }

  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-reason]");
    if (!b || !popFor) return;
    const id = popFor;
    closeWhy();
    dismissed.setReason(id, b.dataset.reason);
    refresh(id);
  });

  pop.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...pop.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  });

  // Any click outside the menu closes it, before that click does its own thing.
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) closeWhy(); }, true);
  addEventListener("resize", () => closeWhy());

  // --- detail panel ----------------------------------------------------

  function open(id) {
    const j = data.jobs.find((x) => x.id === id);
    if (!j) return;
    selectedId = id;
    for (const li of list.children) li.classList.toggle("selected", li.dataset.id === id);

    const done = applied.get(id);
    const passedEntry = dismissed.get(id);
    const m = model || profile.fit();
    const judged = j.judge || profile.judge(j, m);
    const others = data.jobs.filter((x) => x.company === j.company && x.id !== j.id);
    const traitList = judged.keys.map((k) => {
      const r = m.rules[k] === "hide" ? " (hidden)" : m.rules[k] === "prefer" ? " (preferred)" : "";
      return esc(traitLabel(k) + r);
    }).join('<span class="sep">·</span>');
    const why = passedEntry && profile.REASON[passedEntry.reason];
    const verdict = passedEntry ? `You marked this Not for me${why ? ": " + why.label : ""}.`
      : done ? "" : profile.explain(judged, m);
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
      done ? ["Applied", `${fullDate(done.at)} <span class="when">${ago(done.at)}</span>`] : null,
      ["Source", sourceLine],
      j.category ? ["Category", esc(j.category)] : null,
      j.degrees && j.degrees.length ? ["Degree", esc(j.degrees.join(", "))] : null,
      j.sponsorship && j.sponsorship !== "Other" ? ["Sponsorship", esc(j.sponsorship)] : null,
      ["Profile", `${verdict ? esc(verdict) + "<br>" : ""}<span class="traits">${traitList}</span>`],
    ].filter(Boolean);

    detailBody.innerHTML = `
      <p class="kicker">${esc(sourceText(j))}</p>
      <h2>${esc(j.title)}</h2>
      <p class="company">${esc(j.company)}</p>
      <a class="apply" href="${esc(j.url)}" target="_blank" rel="noopener">Apply</a>
      <button type="button" class="mark" id="mark">${done ? "Applied · undo" : "Mark as applied"}</button>
      ${done ? "" : `<button type="button" class="mark" id="pass">${passedEntry ? "Not for me · undo" : "Not for me"}</button>`}
      ${j.company_url ? `<a class="also" href="${esc(j.company_url)}" target="_blank" rel="noopener">Company on Simplify</a>` : ""}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${others.length ? `<div class="more"><h3>Also at ${esc(j.company)}</h3><ul>${
        others.map((o) => `<li data-id="${esc(o.id)}">${esc(o.title)}<span class="where">${esc(o.locations[0] || "")}</span></li>`).join("")
      }</ul></div>` : ""}
      <p class="note">The watcher keeps only the listing metadata each board exposes. The full description and requirements are on the posting itself.</p>
    `;
    if (detail.hidden) {
      detail.hidden = false;
      detail.scrollTop = 0;
    }
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
    if (e.target.closest("#mark")) { toggleApplied(selectedId); return; }
    if (e.target.closest("#pass")) { togglePassed(selectedId, "panel"); return; }
    const li = e.target.closest("li[data-id]");
    if (li) {
      open(li.dataset.id);
      const row = list.querySelector(`li[data-id="${CSS.escape(li.dataset.id)}"]`);
      if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!pop.hidden) closeWhy(true);
    else if (!detail.hidden) close();
  });

  // Another tab (or the applied or profile page) changed a store: redraw.
  const STORES = ["applied", "dismissed", "rules", "muted"];
  addEventListener("storage", (e) => { if (STORES.includes(e.key) && data.jobs.length) apply(); });

  // --- url state: filters and open listing survive a reload / share ----

  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(currentFilters())) {
      if (v && !(k === "sort" && v === "newest")) p.set(k, v);
    }
    if (view !== "foryou") p.set("view", view);
    if (selectedId) p.set("job", selectedId);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    view = ["all", "aside"].includes(p.get("view")) ? p.get("view") : "foryou";
    for (const el of form.elements) {
      if (el.name && p.has(el.name)) el.value = p.get(el.name);
    }
    return p.get("job");
  }

  // --- header ----------------------------------------------------------

  function renderIntro() {
    const s = data.scanned || {};
    const age = Date.now() / 1000 - data.generated_at;
    const stale = age > 3 * 3600
      ? ` <span class="stale">The watcher hasn&rsquo;t reported in ${ago(data.generated_at).replace(" ago", "")}, so this may be behind.</span>`
      : "";
    $("#intro").innerHTML = `Last checked ${ago(data.generated_at)}.${stale}`;
    const polled = data.companies_polled || [];
    // Some companies have a second campus board, so count names, not boards.
    $("#board-count").textContent = polled.length || s.boards || "";
    $("#board-list").textContent = polled.join(", ") + ".";
    $("#board-list").closest("details").querySelector("summary").textContent =
      `Boards polled directly (${polled.length})`;
  }

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
        j.traits = traitsOf(j);
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
