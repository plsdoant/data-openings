/* The profile: roles you've passed on, the rules you've set, and a small
   model fitted from those plus your applications. Like the applied store,
   it all lives in this browser's localStorage.

   The model is a smoothed log-odds weight per trait. For each trait it
   compares how often you applied to jobs that have it against how often
   you passed on them, with the two sides balanced so that a couple of
   hundred applications don't make every pass look damning, and pulled
   toward even until there is enough evidence to say otherwise. A job's
   score is the sum of its traits' weights. Learned weights only ever set
   a listing aside; hiding takes a rule you set yourself. */

(function () {
  "use strict";

  const Site = window.Site;

  const DAY = 86400;
  const HALF_LIFE = 30 * DAY;  // feedback a month old counts half
  const PRIOR = 4;             // pseudo-observations, split evenly
  const MIN_SEEN = 3;          // a trait seen once or twice learns nothing
  const MIN_PASSED = 10;       // dimming stays off until this many passes
  const DIM_AT = -1.5;         // a score at or below this is "probably not"
  const DRAG_AT = -0.5;        // a trait weighing at least this much is named as a reason
  const SUGGEST_AT = 4;        // evidence before the profile page proposes a rule

  // Why you passed on something, and the trait groups each reason points
  // at. Every trait of a job you passed on counts half against it, since
  // most of them weren't the problem; a reason makes the traits it names
  // count double instead.
  Site.REASONS = [
    ["level", "Too senior", ["level"]],
    ["degree", "Grad degree", ["degree"]],
    ["role", "Wrong role", ["role"]],
    ["where", "Location", ["where"]],
    ["company", "Company", ["company"]],
    ["term", "Term", ["term", "kind"]],
    ["other", "Other", null],
  ];
  const REASON = Object.fromEntries(Site.REASONS.map(([k, label, groups]) => [k, { label, groups }]));

  // --- stores ----------------------------------------------------------

  function store(key) {
    return {
      load() {
        try {
          const m = JSON.parse(localStorage.getItem(key));
          return m && typeof m === "object" && !Array.isArray(m) ? m : {};
        } catch (e) { return {}; }
      },
      save(m) {
        try { localStorage.setItem(key, JSON.stringify(m)); } catch (e) { /* private mode */ }
        dispatchEvent(new CustomEvent("profile-change"));
      },
    };
  }

  const passedStore = store("dismissed");
  const rulesStore = store("rules");
  const mutedStore = store("muted");

  // { [job id]: snapshot + reason } for roles marked "Not for me".
  Site.dismissed = {
    all: () => passedStore.load(),
    get: (id) => passedStore.load()[id] || null,
    has: (id) => Object.prototype.hasOwnProperty.call(passedStore.load(), id),
    count: () => Object.keys(passedStore.load()).length,
    add(job, reason) {
      const m = passedStore.load();
      m[job.id] = Site.snapshot(job);
      if (reason) m[job.id].reason = reason;
      passedStore.save(m);
    },
    setReason(id, reason) {
      const m = passedStore.load();
      if (!m[id]) return;
      if (reason) m[id].reason = reason; else delete m[id].reason;
      passedStore.save(m);
    },
    remove(id) { const m = passedStore.load(); delete m[id]; passedStore.save(m); },
    merge(entries) {
      const m = passedStore.load();
      let added = 0;
      for (const e of entries) {
        if (e && e.id && e.title && !m[e.id]) { m[e.id] = e; added++; }
      }
      passedStore.save(m);
      return added;
    },
    clear() { passedStore.save({}); },
  };

  // { [trait]: "hide" | "prefer" }, set on the profile page.
  Site.rules = {
    all: () => rulesStore.load(),
    get: (key) => rulesStore.load()[key] || null,
    set(key, state) {
      const m = rulesStore.load();
      if (state === "hide" || state === "prefer") m[key] = state; else delete m[key];
      rulesStore.save(m);
      if (state) Site.muted.remove(key);
    },
    clear() { rulesStore.save({}); },
  };

  // { [trait]: when } for suggestions you said no to.
  Site.muted = {
    all: () => mutedStore.load(),
    add(key) { const m = mutedStore.load(); m[key] = Math.floor(Date.now() / 1000); mutedStore.save(m); },
    remove(key) { const m = mutedStore.load(); if (key in m) { delete m[key]; mutedStore.save(m); } },
    clear() { mutedStore.save({}); },
  };

  // Changes from another tab arrive as storage events; pass them on.
  addEventListener("storage", (e) => {
    if (e.key === "dismissed" || e.key === "rules" || e.key === "muted") {
      dispatchEvent(new CustomEvent("profile-change"));
    }
  });

  // --- the model -------------------------------------------------------

  const logit = (p) => Math.log(p / (1 - p));

  function decay(at, now) {
    return at ? Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE) : 1;
  }

  // Saying why you passed fills in what the title didn't: "Grad degree"
  // on a listing with no degree trait still teaches the degree trait.
  function passedTraits(s) {
    const keys = Site.traitsOf(s);
    if (s.reason === "degree" && !keys.includes("degree:grad")) {
      const i = keys.indexOf("degree:undergrad");
      if (i >= 0) keys.splice(i, 1);
      keys.push("degree:grad");
    }
    if (s.reason === "level" && !keys.includes("level:senior")) keys.push("level:senior");
    return keys;
  }

  // Groups where a listing with none of the group's traits says nothing,
  // rather than "not this": no degree listed, no location typed, no term
  // tagged. Applications saved before degrees were, and roles added by
  // hand, often lack these, so the traits are weighed only against
  // feedback that carries them. Otherwise missing data reads as dislike.
  const PARTIAL = ["degree", "where", "term"];

  // Fit from scratch on every call. It's a few hundred records at most, so
  // this takes a millisecond and there's no trained state to go stale.
  function fit() {
    const now = Date.now() / 1000;
    const stats = {};
    const stat = (k) => stats[k] || (stats[k] = { key: k, a: 0, d: 0, applied: 0, passed: 0, strong: 0, w: 0 });
    // Total weight of applications (A) and passes (D) overall and within
    // each partial group, for balancing the two sides.
    const base = { all: { A: 0, D: 0 } };
    for (const g of PARTIAL) base[g] = { A: 0, D: 0 };
    const tally = (keys, side, amount) => {
      base.all[side] += amount;
      const groups = new Set(keys.map(Site.traitGroup));
      for (const g of PARTIAL) if (groups.has(g)) base[g][side] += amount;
    };

    const appliedList = Object.values(Site.applied.all());
    const passedList = Object.values(Site.dismissed.all());

    for (const s of appliedList) {
      const w = decay(s.at, now);
      const keys = Site.traitsOf(s);
      tally(keys, "A", w);
      for (const k of keys) { const t = stat(k); t.a += w; t.applied++; }
    }

    for (const s of passedList) {
      const w = decay(s.at, now);
      const groups = (REASON[s.reason] || {}).groups || null;
      const keys = passedTraits(s);
      tally(keys, "D", w / 2);
      for (const k of keys) {
        const t = stat(k);
        const named = groups && groups.includes(Site.traitGroup(k));
        t.d += named ? 2 * w : w / 2;
        t.passed++;
        if (named || !groups) t.strong++;   // passed on for this reason, or no reason given
      }
    }

    // Applications are scaled to weigh as much in total as passes, so a
    // trait's weight says whether it turns up more among what you pass on
    // than among what you apply to, whatever the ratio of the two.
    for (const t of Object.values(stats)) {
      if (t.applied + t.passed < MIN_SEEN) continue;
      const g = Site.traitGroup(t.key);
      const b = base[g] || base.all;
      if (!b.D) continue;
      const a = b.A ? t.a * (b.D / b.A) : 0;
      t.w = logit((a + PRIOR / 2) / (a + t.d + PRIOR));
    }

    return {
      stats,
      rules: Site.rules.all(),
      muted: Site.muted.all(),
      applied: appliedList.length,
      passed: passedList.length,
      active: passedList.length >= MIN_PASSED,
      needed: Math.max(0, MIN_PASSED - passedList.length),
    };
  }

  // Where one job lands in the "For you" view, and why.
  function judge(job, model) {
    const keys = job.traits || Site.traitsOf(job);
    const hide = keys.filter((k) => model.rules[k] === "hide");
    const prefer = keys.filter((k) => model.rules[k] === "prefer");
    let score = 0;
    const drag = [];
    for (const k of keys) {
      const t = model.stats[k];
      if (!t || !t.w) continue;
      score += t.w;
      if (t.w <= DRAG_AT && t.strong) drag.push(k);   // only traits you've actually passed on for
    }
    drag.sort((a, b) => model.stats[a].w - model.stats[b].w);
    let verdict = "shown";
    if (hide.length) verdict = "hidden";
    else if (model.active && !prefer.length && score <= DIM_AT) verdict = "dimmed";
    return { verdict, score, hide, prefer, drag, keys };
  }

  // Out of totals, since the two sides are compared as shares: 5 of 10
  // passes outweighs 21 of 214 applications.
  function evidence(t, model) {
    return `in ${t.passed} of ${model.passed} passes, ${t.applied} of ${model.applied} applications`;
  }

  // One sentence for the detail panel and the row.
  function explain(j, model) {
    const L = Site.traitLabel;
    if (j.verdict === "hidden") return `Hidden by your rule: ${j.hide.map(L).join(", ")}.`;
    if (j.verdict === "dimmed") {
      const top = j.drag.slice(0, 2).map((k) => `${L(k)} (${evidence(model.stats[k], model)})`);
      return `Probably not for you: ${top.join("; ")}.`;
    }
    if (j.prefer.length) return `Matches what you prefer: ${j.prefer.map(L).join(", ")}.`;
    return "";
  }

  // Traits worth turning into rules: passed on again and again and never
  // applied to, or (for roles) the reverse. Preferences wait until you've
  // passed on enough to compare against; before that every role you've
  // applied to looks like a favourite.
  function suggestions(model) {
    const out = [];
    for (const t of Object.values(model.stats)) {
      if (model.rules[t.key] || model.muted[t.key]) continue;
      if (t.strong >= SUGGEST_AT && t.applied === 0) out.push({ key: t.key, kind: "hide", t });
      else if (model.active && Site.traitGroup(t.key) === "role" && t.applied >= SUGGEST_AT + 1 && t.passed === 0 && t.w >= 0.5) {
        out.push({ key: t.key, kind: "prefer", t });
      }
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "hide" ? -1 : 1) || b.t.strong - a.t.strong || b.t.applied - a.t.applied);
  }

  Site.profile = { fit, judge, explain, suggestions, evidence, REASON, DIM_AT, MIN_PASSED };

  // --- backup ----------------------------------------------------------
  // One file for applications and the profile, so either page can move
  // everything to another browser.

  Site.backup = {
    download() {
      const byDate = (m) => Object.values(m).sort((a, b) => b.at - a.at);
      const body = {
        exported_at: Math.floor(Date.now() / 1000),
        applied: byDate(Site.applied.all()),
        dismissed: byDate(Site.dismissed.all()),
        rules: Site.rules.all(),
        muted: Site.muted.all(),
      };
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `data-openings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    // Adds what's new and keeps what's here. Older files are just the
    // applied list, as an array or a map.
    import(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("not a backup");
      const applied = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.applied) ? parsed.applied
        : !("dismissed" in parsed) ? Object.values(parsed) : [];
      const out = { applied: Site.applied.merge(applied), dismissed: 0, rules: 0 };
      if (Array.isArray(parsed.dismissed)) out.dismissed = Site.dismissed.merge(parsed.dismissed);
      if (parsed.rules && typeof parsed.rules === "object") {
        const have = Site.rules.all();
        for (const [k, v] of Object.entries(parsed.rules)) {
          if (!have[k] && (v === "hide" || v === "prefer")) { Site.rules.set(k, v); out.rules++; }
        }
      }
      if (parsed.muted && typeof parsed.muted === "object") {
        for (const k of Object.keys(parsed.muted)) if (!Site.rules.get(k)) Site.muted.add(k);
      }
      return out;
    },

    summary(got) {
      const n = (k, one, many) => got[k] ? `${got[k]} ${got[k] === 1 ? one : many}` : "";
      const parts = [n("applied", "application", "applications"), n("dismissed", "role passed on", "roles passed on"),
                     n("rules", "rule", "rules")].filter(Boolean);
      return parts.length ? `Added ${parts.join(", ")}.` : "Nothing new in that file.";
    },
  };
})();
