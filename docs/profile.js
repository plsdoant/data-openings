/* Profile page: what the model has learned from your applications and the
   roles you've passed on, the rules you've set, and suggestions for new
   ones. */

(function () {
  "use strict";

  const {
    esc, shortDate, fullDate, sourceText, applied, dismissed, rules, muted, profile, backup,
    TRAITS, TRAIT_GROUPS, STATE_NAMES, traitLabel, traitGroup, traitsOf,
  } = window.Site;
  const $ = (sel) => document.querySelector(sel);

  let listed = null;          // trait -> how many current listings have it, once jobs.json loads
  let companies = [];         // every company the watcher knows, for the rule form
  const opened = new Set();   // trait groups unfolded this visit, kept across redraws

  const GROUP_NAME = Object.fromEntries(TRAIT_GROUPS);
  const FIXED = new Set(TRAITS.map((t) => t.key));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // --- intro -----------------------------------------------------------

  function renderIntro(m) {
    let s = `Built from ${plural(m.applied, "application", "applications")} and ` +
      `${plural(m.passed, "role", "roles")} passed on, in this browser.`;
    s += m.active
      ? " Listings it expects you to skip move from For you to Set aside, along with anything your rules hide."
      : ` It starts setting listings aside after ${profile.MIN_PASSED} passes, ${m.needed} to go. Until then only your rules change what For you shows.`;
    $("#intro").textContent = s;
  }

  // --- suggestions -----------------------------------------------------

  function renderSuggestions(m) {
    const list = profile.suggestions(m);
    const box = $("#suggest");
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h2>Suggestions</h2><ul class="plain">${list.map(({ key, kind, t }) => {
      const text = kind === "hide"
        ? `you’ve passed on ${t.strong} and applied to none.`
        : `you’ve applied to ${t.applied} and passed on none.`;
      return `<li data-key="${esc(key)}">
        <span><b>${esc(traitLabel(key))}</b>: ${esc(text)}</span>
        <span class="acts">
          <button type="button" data-set="${kind}">${kind === "hide" ? "Hide these" : "Prefer these"}</button>
          <button type="button" data-mute>No thanks</button>
        </span>
      </li>`;
    }).join("")}</ul>`;
  }

  // --- rules -----------------------------------------------------------

  function where(k) {
    const g = traitGroup(k);
    const n = listed ? `${listed[k] || 0} listed now` : "";
    return [GROUP_NAME[g] || g, n].filter(Boolean).join(" · ");
  }

  function renderRules(m) {
    const entries = Object.entries(m.rules)
      .sort(([a, x], [b, y]) => (x === y ? 0 : x === "hide" ? -1 : 1) || traitLabel(a).localeCompare(traitLabel(b)));
    $("#rules").innerHTML = entries.length
      ? `<ul class="plain">${entries.map(([k, st]) => `<li data-key="${esc(k)}">
          <span>${st === "hide" ? "Hide" : "Prefer"} <b>${esc(traitLabel(k))}</b><span class="note">${esc(where(k))}</span></span>
          <span class="acts"><button type="button" data-set="">Remove</button></span>
        </li>`).join("")}</ul>`
      : `<p class="empty-note">No rules yet. Choose Hide or Prefer on any trait below, or add a company or location.</p>`;
  }

  // --- traits ----------------------------------------------------------

  // Before enough passes every weight leans "yes", since there's nothing
  // to compare against, so the bar waits until learning has started.
  function lean(w, m) {
    if (!m.active) return `<span class="lean" title="Learning starts after ${profile.MIN_PASSED} passes"></span>`;
    if (!w) return `<span class="lean" title="Nothing learned yet"></span>`;
    const pct = (Math.min(Math.abs(w) / 3, 1) * 50).toFixed(1);
    const side = w < 0 ? `right:50%` : `left:50%`;
    const title = `${w < 0 ? "Leans against" : "Leans toward"}, weight ${w < 0 ? "−" : "+"}${Math.abs(w).toFixed(1)}`;
    return `<span class="lean" title="${title}"><span style="${side};width:${pct}%"></span></span>`;
  }

  function traitRow(k, m) {
    const t = m.stats[k] || { applied: 0, passed: 0, w: 0 };
    const st = m.rules[k] || "";
    const facts = [listed ? `${listed[k] || 0} listed` : "", `${t.applied} applied`, `${t.passed} passed`].filter(Boolean);
    const seg = [["prefer", "Prefer"], ["", "Neutral"], ["hide", "Hide"]].map(([v, label]) =>
      `<button type="button" data-set="${v}" aria-pressed="${st === v}">${label}</button>`).join("");
    return `<div class="trait" data-key="${esc(k)}">
      <span class="name">${esc(traitLabel(k))}</span>
      <span class="counts">${facts.join(" · ")}</span>
      ${lean(t.w, m)}
      <span class="seg" role="group" aria-label="${esc(traitLabel(k))}">${seg}</span>
    </div>`;
  }

  // Fixed traits are always listed, so you can set a rule before the model
  // has seen one. Locations and companies show once they've come up in
  // your feedback or a rule, most-seen first. Each group starts folded,
  // with its rules counted on the fold.
  function renderTraits(m) {
    const byGroup = {};
    for (const t of TRAITS) (byGroup[t.group] = byGroup[t.group] || []).push(t.key);
    const seen = (k) => { const t = m.stats[k]; return t ? t.applied + t.passed : 0; };
    const extra = new Set([...Object.keys(m.stats), ...Object.keys(m.rules)].filter((k) => !FIXED.has(k)));
    for (const k of [...extra].sort((a, b) => seen(b) - seen(a) || traitLabel(a).localeCompare(traitLabel(b)))) {
      (byGroup[traitGroup(k)] = byGroup[traitGroup(k)] || []).push(k);
    }
    $("#traits").innerHTML = `<h2>Traits</h2>` + TRAIT_GROUPS.map(([g, name]) => {
      const keys = byGroup[g] || [];
      if (!keys.length) return "";
      const hidden = keys.filter((k) => m.rules[k] === "hide").length;
      const preferred = keys.filter((k) => m.rules[k] === "prefer").length;
      const note = [plural(keys.length, "trait", "traits"), hidden ? `${hidden} hidden` : "", preferred ? `${preferred} preferred` : ""]
        .filter(Boolean).join(" · ");
      return `<details class="trait-group" data-group="${g}"${opened.has(g) ? " open" : ""}>
        <summary>${esc(name)}<span class="note">${note}</span></summary>
        ${keys.map((k) => traitRow(k, m)).join("")}
      </details>`;
    }).join("");
  }

  // --- roles passed on -------------------------------------------------

  function renderPassed() {
    const items = Object.values(dismissed.all()).sort((a, b) => b.at - a.at);
    $("#passed").hidden = !items.length;
    $("#passed-summary").textContent = `Roles passed on (${items.length})`;
    $("#passed-list").innerHTML = items.map((i) => {
      const loc = (i.locations || []).slice(0, 2).join("; ");
      const reason = i.reason && profile.REASON[i.reason] ? profile.REASON[i.reason].label : "";
      const parts = [i.company, loc, reason].filter(Boolean).map(esc);
      return `<li data-id="${esc(i.id)}">
        <span class="age" title="Passed on ${esc(fullDate(i.at))}">${esc(shortDate(i.at))}</span>
        <div>
          <h3 class="title">${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</h3>
          <div class="meta">${parts.join('<span class="sep">·</span>')}</div>
        </div>
        <span class="source">${esc(sourceText(i))}</span>
        <button type="button" class="pass" aria-pressed="true" aria-label="Undo" title="Not for me. Click to undo.">&times;</button>
      </li>`;
    }).join("");
  }

  function render() {
    const m = profile.fit();
    renderIntro(m);
    renderSuggestions(m);
    renderRules(m);
    renderTraits(m);
    renderPassed();
  }

  // --- interactions ----------------------------------------------------

  document.addEventListener("click", (e) => {
    const set = e.target.closest("[data-set]");
    const mute = e.target.closest("[data-mute]");
    const keyEl = e.target.closest("[data-key]");
    if (keyEl && set) { rules.set(keyEl.dataset.key, set.dataset.set || null); return; }
    if (keyEl && mute) { muted.add(keyEl.dataset.key); return; }
    const pass = e.target.closest("#passed-list .pass");
    if (pass) dismissed.remove(pass.closest("li[data-id]").dataset.id);
  });

  // Companies are matched to the watcher's spelling where possible, since
  // that's what the trait uses. Locations are states or Remote.
  const ruleForm = $("#rule-form");
  const ruleStatus = $("#rule-status");
  const STATES = Object.values(STATE_NAMES);

  function fillOptions() {
    const g = ruleForm.elements.group.value;
    const opts = g === "where" ? ["Remote", ...STATES.slice().sort()] : companies;
    $("#rule-options").innerHTML = opts.map((o) => `<option value="${esc(o)}">`).join("");
    ruleForm.elements.value.placeholder = g === "where" ? "Texas, or Remote" : "Capital One";
  }

  function resolve(group, raw) {
    const v = raw.trim();
    const low = v.toLowerCase();
    if (group === "where") {
      if (low === "remote") return "Remote";
      if (STATE_NAMES[v.toUpperCase()]) return STATE_NAMES[v.toUpperCase()];
      return STATES.find((s) => s.toLowerCase() === low) || null;
    }
    return companies.find((c) => c.toLowerCase() === low) || v || null;
  }

  ruleForm.addEventListener("change", (e) => { if (e.target.name === "group") fillOptions(); });
  ruleForm.addEventListener("input", () => { ruleStatus.textContent = ""; });
  ruleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = ruleForm.elements;
    const name = resolve(f.group.value, f.value.value);
    if (!name) { ruleStatus.textContent = "Use a state name, like Texas, or Remote."; return; }
    rules.set(`${f.group.value}:${name}`, f.state.value);
    ruleStatus.textContent = `${f.state.value === "hide" ? "Hiding" : "Preferring"} ${name}.`;
    f.value.value = "";
  });

  $("#export").addEventListener("click", () => backup.download());

  $("#import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((text) => {
      let got;
      try { got = backup.import(text); } catch (err) { alert("That file isn't a backup from this site."); return; }
      alert(backup.summary(got));
      e.target.value = "";
    });
  });

  $("#forget").addEventListener("click", () => {
    const n = dismissed.count();
    if (n && confirm(`Forget all ${n} roles you passed on? What the profile learned from them goes too. Your rules and applications stay.`)) {
      dismissed.clear();
      muted.clear();
    }
  });

  $("#clear-rules").addEventListener("click", () => {
    const n = Object.keys(rules.all()).length;
    if (n && confirm(`Remove all ${n} rules?`)) rules.clear();
  });

  // toggle doesn't bubble, so listen on the way down.
  $("#traits").addEventListener("toggle", (e) => {
    const g = e.target.dataset && e.target.dataset.group;
    if (!g) return;
    if (e.target.open) opened.add(g); else opened.delete(g);
  }, true);

  addEventListener("profile-change", render);
  addEventListener("applied-change", render);

  // --- boot ------------------------------------------------------------

  render();
  fillOptions();
  fetch("jobs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      listed = {};
      for (const j of d.jobs) for (const k of traitsOf(j)) listed[k] = (listed[k] || 0) + 1;
      const names = new Set([...(d.companies_polled || []), ...d.jobs.map((j) => j.company)]);
      companies = [...names].sort((a, b) => a.localeCompare(b));
      fillOptions();
      render();
    })
    .catch(() => { /* the profile works without the feed, just without counts */ });
})();
