/* Traits: the named features the profile learns from. Each job gets a list
   of keys like "role:science" or "where:Texas", worked out from its title,
   locations, terms, and the degrees Simplify lists. The model and the
   profile page only ever see these keys, so everything it learns is
   something you can read, prefer, or hide.

   The table is plain patterns on purpose, so the watcher could apply the
   same rules to Discord later. */

(function () {
  "use strict";

  const Site = window.Site;

  // Groups in the order the profile page shows them.
  Site.TRAIT_GROUPS = [
    ["role", "Role"],
    ["area", "Area"],
    ["level", "Seniority"],
    ["degree", "Degree"],
    ["req", "Requirements"],
    ["kind", "Type"],
    ["term", "Term"],
    ["where", "Location"],
    ["company", "Company"],
  ];

  // t is the lowercased title, T the title as written (for acronyms like
  // IT that are ordinary words in lower case).
  const ROLES = [
    ["role:analytics", "Data analyst & analytics", (t) => /data analy|analytics|data (and|&) insights|data visuali/.test(t)],
    ["role:science", "Data science", (t) => /data scien|scientist|decision scien|applied scien/.test(t)],
    ["role:bi", "BI & reporting", (t) => /business intelligence|\bbi\b|power bi|tableau|reporting|dashboard/.test(t)],
    ["role:business", "Business & systems analyst", (t) => /business (technical |systems )?analyst|business analysis|systems analyst/.test(t)],
    ["role:engineering", "Data engineering", (t) => /data engineer|analytics engineer|data platform|\betl\b|pipeline|warehouse|database|data architect|data infrastructure/.test(t)],
    ["role:ml", "AI & machine learning", (t) => /\bai\b|artificial intelligence|machine learning|\bml\b|deep learning|computer vision|\bnlp\b|natural language|gen ?ai|\bllms?\b|generative/.test(t)],
    ["role:software", "Software engineering", (t) => /software|developer|\bswe\b|full[- ]?stack|back[- ]?end|front[- ]?end/.test(t)],
    ["role:quant", "Quant", (t) => /\bquant/.test(t)],
    ["role:research", "Research", (t) => /research/.test(t)],
    ["role:governance", "Data governance & management", (t) => /governance|data quality|master data|data management|metadata|data steward/.test(t)],
    ["role:program", "Program & project management", (t) => /(program|project) ma[n]?ag|\bpmo\b/.test(t)],
  ];

  // Only when none of the roles above matched.
  const FALLBACK_ROLES = [
    ["role:analyst", "Analyst, other", (t) => /\banalyst/.test(t)],
    ["role:data", "Data, general", (t) => /\bdata\b/.test(t)],
    ["role:other", "Other", () => true],
  ];

  const AREAS = [
    ["area:finance", "Finance & insurance", (t) => /financ|fp&a|accounting|treasury|investment|capital markets|banking|\bcredit\b|\brisk\b|audit|\btax\b|insurance|actuar|trading|wealth|portfolio/.test(t)],
    ["area:marketing", "Marketing", (t) => /marketing|\bgrowth\b|\bcrm\b|campaign|\bbrand|social media|advertis|\bmedia\b|e-?commerce|(customer|consumer) insight/.test(t)],
    ["area:sales", "Sales & revenue", (t) => /\bsales\b|revenue|commercial|pricing|go-to-market|\bgtm\b/.test(t)],
    ["area:operations", "Operations & supply chain", (t) => /operations|supply chain|logistics|procurement|manufactur|sourcing|fulfil|inventory/.test(t)],
    ["area:it", "IT & security", (t, T) => /\bIT\b/.test(T) || /information technology|\bmis\b|cyber|\bsecurity\b/.test(t)],
    ["area:hr", "HR & people", (t) => /human resources|\bhr\b|people analytics|workforce|talent/.test(t)],
    ["area:health", "Health & life sciences", (t) => /health|clinical|medical|pharm|oncology|patient|biotech|genomic|\bdrug|hospital|epidemiolog|life science/.test(t)],
    ["area:product", "Product", (t) => /\bproduct\b/.test(t)],
    ["area:consulting", "Consulting & strategy", (t) => /consult|advisory|assurance|\bstrateg/.test(t)],
    ["area:energy", "Energy & utilities", (t) => /energy|\bgrid\b|utilit|renewable|\boil\b|\bpower\b(?!\s*bi)|electric/.test(t)],
    ["area:government", "Government & policy", (t) => /government|federal|public sector|\bpolicy\b|defen[cs]e/.test(t)],
  ];

  // "Rising senior" and "college senior" describe the student, not the role.
  const STUDENT_SENIOR = /rising senior|college senior|senior year|seniors\b/g;
  const GRAD_RE = /\bmaster'?s\b|\bmba\b|ph\.?d|doctoral|\bgraduate (student|intern)|\bgrad student|post-?doc/;
  const UNDERGRAD_RE = /\bundergrad(uate)?s?\b|bachelor/;
  // "Intern II" is an intern pay band, not a senior role.
  const INTERN_RE = /\bintern(s|ship|ships)?\b|\bco[- ]?op\b|apprentice|\bstudent|summer (analyst|associate)|trainee|fellow|\bextern/;

  const OTHER = [
    ["level:senior", "Senior or experienced",
      (t, T) => /\bsr\b|\bsenior\b|\bprincipal\b|\bdirector\b|\bhead of\b|\bexperienced\b|mid[- ]level|\bstaff (data|software|machine|analyst|engineer|scientist)/.test(t.replace(STUDENT_SENIOR, " ")) ||
                (/\b(II|III|IV)\b/.test(T) && !INTERN_RE.test(t))],
    ["degree:undergrad", "Undergraduates welcome", (t, T, j) => degreeOf(t, j) === "undergrad"],
    ["degree:grad", "Master's, MBA, or PhD only", (t, T, j) => degreeOf(t, j) === "grad"],
    ["req:clearance", "Security clearance", (t) => /clearance|ts\/sci|\bsecret\b|polygraph/.test(t)],
    ["req:citizen", "US citizens only", (t) => /\bu\.?s\.? citizen|citizenship/.test(t)],
    ["kind:not-intern", "Not called an internship",
      (t) => !INTERN_RE.test(t)],
    ["kind:coop", "Co-op", (t) => /\bco[- ]?op\b/.test(t)],
    ["kind:part-time", "Part-time", (t) => /part[- ]time|student (assistant|worker)/.test(t)],
    ["term:summer", "Summer", (t, T, j) => hasSeason(t, j, "summer")],
    ["term:fall", "Fall", (t, T, j) => hasSeason(t, j, "fall")],
    ["term:spring", "Spring", (t, T, j) => hasSeason(t, j, "spring")],
    ["term:winter", "Winter", (t, T, j) => hasSeason(t, j, "winter")],
  ];

  // A degree said in the title wins over Simplify's list, which is often a
  // default. No signal either way means no degree trait, so an unknown is
  // never read as "Master's only".
  function degreeOf(t, job) {
    if (UNDERGRAD_RE.test(t)) return "undergrad";
    if (GRAD_RE.test(t)) return "grad";
    const ds = job.degrees || [];
    if (!ds.length) return null;
    return ds.some((d) => /bachelor|associate/i.test(d)) ? "undergrad" : "grad";
  }

  function hasSeason(t, job, season) {
    const re = season === "fall" ? /\b(fall|autumn)\b/ : new RegExp("\\b" + season + "\\b");
    return re.test(t) || (job.terms || []).some((x) => re.test(x.toLowerCase()));
  }

  const FIXED = [...ROLES, ...FALLBACK_ROLES, ...AREAS, ...OTHER];
  const LABEL = Object.fromEntries(FIXED.map(([k, label]) => [k, label]));

  // Every fixed trait, for the profile page to offer rules on before any
  // listing has one.
  Site.TRAITS = FIXED.map(([key, label]) => ({ key, label, group: key.split(":")[0] }));

  Site.traitGroup = (key) => key.slice(0, key.indexOf(":"));

  Site.traitLabel = function (key) {
    if (LABEL[key]) return LABEL[key];
    return key.slice(key.indexOf(":") + 1);   // where:Texas, company:Capital One
  };

  Site.traitsOf = function (job) {
    const T = (job.title || "").replace(/[‘’]/g, "'");
    const t = T.toLowerCase();
    const out = [];
    for (const [key, , test] of ROLES) if (test(t, T, job)) out.push(key);
    if (!out.length) {
      for (const [key, , test] of FALLBACK_ROLES) if (test(t, T, job)) { out.push(key); break; }
    }
    for (const [key, , test] of [...AREAS, ...OTHER]) if (test(t, T, job)) out.push(key);
    for (const r of Site.regionsOf(job)) if (r !== "United States") out.push("where:" + r);
    if (job.company) out.push("company:" + job.company);
    return out;
  };
})();
