/* Shared by the listings page and the applied page: formatting helpers, the
   applied-jobs store (localStorage, this browser only), the theme switch,
   and the back-to-top button. */

(function () {
  "use strict";

  const Site = (window.Site = {});

  // --- labels and formatting -------------------------------------------

  Site.SOURCE_LABEL = { simplify: "Simplify", jobright: "Jobright", ats: "Company board" };
  Site.SOURCE_URL = {
    simplify: "https://github.com/SimplifyJobs/Summer2027-Internships",
    jobright: "https://github.com/jobright-ai/2026-Data-Analysis-Internship",
  };
  Site.ROLE_LABEL = {
    analyst: "Data analyst", science: "Data science", engineering: "Data engineering",
    bi: "Business & BI", other: "Other",
  };

  Site.roleOf = function (job) {
    const t = job.title.toLowerCase();
    if (/data scien|scientist/.test(t)) return "science";
    if (/data engineer|engineering|data platform|\betl\b|pipeline|warehouse/.test(t)) return "engineering";
    if (/business intelligence|\bbi\b|power bi|business analy|reporting|insights/.test(t)) return "bi";
    if (/analy/.test(t) || /\bdata\b/.test(t)) return "analyst";
    return "other";
  };

  Site.sourceText = function (job) {
    if (job.source === "ats") return job.board ? "Direct · " + job.board : "Direct";
    return Site.SOURCE_LABEL[job.source] || job.source;
  };

  Site.ago = function (ts) {
    if (!ts) return "";
    const s = Date.now() / 1000 - ts;
    if (s < 3600) return s < 300 ? "just now" : Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    const d = Math.floor(s / 86400);
    if (d < 14) return d + (d === 1 ? " day ago" : " days ago");
    return Math.floor(d / 7) + "w ago";
  };

  Site.fullDate = function (ts) {
    if (!ts) return "unknown";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
  };

  Site.shortDate = function (ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  Site.esc = function (s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  };

  // --- applied store ---------------------------------------------------
  // { [job id]: snapshot } so a job you applied to still shows up here after
  // it has dropped off the listings. Lives in this browser's localStorage.

  const KEY = "applied";

  function load() {
    try {
      const m = JSON.parse(localStorage.getItem(KEY));
      return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
  }

  function save(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
    dispatchEvent(new CustomEvent("applied-change"));
  }

  function snapshot(j) {
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      url: j.url,
      locations: j.locations || [],
      terms: j.terms || [],
      source: j.source,
      board: j.board || null,
      posted: j.posted || 0,
      role: j.role || Site.roleOf(j),
      at: Math.floor(Date.now() / 1000),
    };
  }

  Site.applied = {
    all: load,
    get: (id) => load()[id] || null,
    has: (id) => Object.prototype.hasOwnProperty.call(load(), id),
    count: () => Object.keys(load()).length,
    add(job) { const m = load(); m[job.id] = snapshot(job); save(m); },
    remove(id) { const m = load(); delete m[id]; save(m); },
    toggle(job) {
      if (Site.applied.has(job.id)) { Site.applied.remove(job.id); return false; }
      Site.applied.add(job);
      return true;
    },
    merge(entries) {
      const m = load();
      let added = 0;
      for (const e of entries) {
        if (e && e.id && e.title && !m[e.id]) { m[e.id] = e; added++; }
      }
      save(m);
      return added;
    },
    clear() { save({}); },
  };

  // Nav link shows the running count.
  function navCount() {
    const a = document.getElementById("nav-applied");
    if (!a) return;
    const n = Site.applied.count();
    a.textContent = n ? `Applied · ${n}` : "Applied";
  }
  addEventListener("applied-change", navCount);
  addEventListener("storage", (e) => { if (e.key === KEY) dispatchEvent(new CustomEvent("applied-change")); });
  navCount();

  // --- theme -----------------------------------------------------------

  const themeBtn = document.getElementById("theme");
  const systemDark = matchMedia("(prefers-color-scheme: dark)");

  function currentTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
  }

  function labelTheme() {
    if (themeBtn) themeBtn.textContent = currentTheme() === "dark" ? "Light" : "Dark";
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
      labelTheme();
    });
    systemDark.addEventListener("change", labelTheme);
    labelTheme();
  }

  // --- back to top -----------------------------------------------------

  const toTop = document.getElementById("to-top");
  if (toTop) {
    const checkScroll = () => { toTop.hidden = scrollY < 600; };
    addEventListener("scroll", checkScroll, { passive: true });
    toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
    checkScroll();
  }
})();
