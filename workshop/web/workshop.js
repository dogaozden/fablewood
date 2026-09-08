(() => {
  "use strict";

  const state = {
    sources: [],
    jobs: [],
    propositions: [],
    relations: [],
    notes: [],
    publications: [],
    catalog: { nodes: [], sources: [] },
    preview: null,
    previewError: "",
    gameMatches: [],
    gameMatchesError: "",
    filter: "all",
    query: "",
    selected: null,
    evidenceDetails: new Map(),
    pollers: new Map(),
  };

  const $ = (selector) => document.querySelector(selector);

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    Object.entries(options).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "className") element.className = value;
      else if (key === "text") element.textContent = String(value);
      else if (key === "dataset") Object.entries(value).forEach(([name, data]) => { element.dataset[name] = String(data); });
      else if (key === "disabled") element.disabled = Boolean(value);
      else if (key === "checked") element.checked = Boolean(value);
      else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
      else element.setAttribute(key, String(value));
    });
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child === undefined || child === null || child === false) return;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  function replaceChildren(target, children) {
    target.replaceChildren(...(Array.isArray(children) ? children : [children]));
  }

  function array(value) { return Array.isArray(value) ? value : []; }
  function value(value, fallback = "Not recorded") { return value === undefined || value === null || value === "" ? fallback : String(value); }
  function humanize(input) { return value(input, "Unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function idOf(item) { return item && (item.id || item.job_id || item.key); }
  function reviewOf(item) { return item && item.review && typeof item.review === "object" ? item.review : { status: "pending" }; }
  function publicationOf(item) { return item && item.publication && typeof item.publication === "object" ? item.publication : { status: "draft" }; }
  function evidenceOf(item) { return array(item && item.evidence); }
  function statusBadge(status, extraClass = "", label = "") {
    const safeStatus = value(status, "unknown").toLowerCase();
    return node("span", { className: `badge ${safeStatus} ${extraClass}`.trim(), text: label || humanize(safeStatus) });
  }
  function formatDate(input) {
    if (!input) return "Not recorded";
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? String(input) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  function formatSeconds(input) {
    if (input === undefined || input === null || input === "") return null;
    const seconds = Number(input);
    if (!Number.isFinite(seconds)) return String(input);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }
  function safeLocalHref(input, fallback) {
    try {
      const parsed = new URL(String(input), window.location.origin);
      if (parsed.origin === window.location.origin && ["http:", "https:"].includes(parsed.protocol)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // Use the known local fallback below.
    }
    return fallback;
  }
  function truncate(text, length = 90) {
    const clean = value(text, "");
    return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
  }

  async function request(path, options = {}) {
    const init = { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } };
    if (options.body && typeof options.body !== "string") {
      init.body = JSON.stringify(options.body);
      init.headers["Content-Type"] = "application/json";
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      throw new Error(`The workshop could not be reached. ${error.message || "Check the local server and try again."}`);
    }
    const raw = await response.text();
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); }
      catch { data = { message: raw }; }
    }
    if (!response.ok) {
      throw new Error(value(data.error || data.message, `Request failed (${response.status}).`));
    }
    return data;
  }

  function setConnection(kind, label) {
    const element = $("#connection-state");
    element.className = `connection-state ${kind ? `is-${kind}` : ""}`.trim();
    replaceChildren(element, [node("span", { className: "status-dot", "aria-hidden": "true" }), label]);
  }

  function showError(target, error) {
    target.textContent = error instanceof Error ? error.message : String(error);
    target.hidden = false;
  }
  function clearError(target) { target.hidden = true; target.textContent = ""; }
  function toast(message, type = "success") {
    const item = node("div", { className: `toast ${type}`, text: message });
    $("#toast-region").append(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function mergeWorkspace(payload) {
    state.sources = array(payload.sources);
    state.jobs = array(payload.jobs);
    state.propositions = array(payload.propositions);
    state.relations = array(payload.relations);
    state.notes = array(payload.notes);
    state.publications = array(payload.publications);
  }

  async function loadWorkspace({ quiet = false } = {}) {
    if (!quiet) setConnection("", "Refreshing");
    try {
      const payload = await request("/api/workshop");
      mergeWorkspace(payload || {});
      try {
        const matching = await request("/api/workshop/game-matches");
        state.gameMatches = array(matching.matches);
        state.gameMatchesError = "";
      } catch (error) {
        state.gameMatches = [];
        state.gameMatchesError = error.message;
      }
      await loadPreview({ quiet: true });
      setConnection("online", "Workshop ready");
      renderAll();
      maintainPolling();
    } catch (error) {
      setConnection("offline", "Workshop unavailable");
      if (!quiet) toast(error.message, "error");
    }
  }

  async function loadCatalog() {
    try {
      const payload = await request("/api/workshop/catalog");
      state.catalog = { nodes: array(payload.nodes), sources: array(payload.sources) };
      renderCatalog();
      renderKnowledge();
      renderNotes();
      renderInspector();
    } catch (error) {
      state.catalog = { nodes: [], sources: [] };
      renderCatalog();
      toast(`Catalog unavailable: ${error.message}`, "error");
    }
  }

  async function loadPreview({ quiet = false } = {}) {
    try {
      const payload = await request("/api/workshop/preview");
      state.preview = payload && typeof payload === "object" ? payload : null;
      state.previewError = "";
    } catch (error) {
      state.preview = null;
      state.previewError = error.message;
      if (!quiet) toast(`Publication preview unavailable: ${error.message}`, "error");
    }
  }

  function renderCatalog() {
    const catalogSelect = $("#catalog-source");
    const currentCatalog = catalogSelect.value;
    replaceChildren(catalogSelect, [
      node("option", { value: "", text: state.catalog.sources.length ? "Choose a registered source…" : "No registered sources available" }),
      ...state.catalog.sources.map((source) => node("option", {
        value: value(source.key, ""),
        text: source.title ? `${source.title}${source.kind ? ` · ${humanize(source.kind)}` : ""}` : value(source.key),
      })),
    ]);
    if (state.catalog.sources.some((source) => String(source.key) === currentCatalog)) catalogSelect.value = currentCatalog;

    [$("#source-node"), $("#note-node")].forEach((select) => {
      const current = select.value;
      const required = select.id === "note-node";
      replaceChildren(select, [
        node("option", { value: "", text: required ? "Choose a destination…" : "Assign during review" }),
        ...state.catalog.nodes.map((item) => node("option", { value: value(item.id, ""), text: value(item.title, item.id) })),
      ]);
      if (state.catalog.nodes.some((item) => String(item.id) === current)) select.value = current;
    });
  }

  function sourceForEvidence(evidence) {
    return state.sources.find((source) => String(source.id) === String(evidence && evidence.source_id)) || null;
  }
  function versionForEvidence(source, evidence) {
    if (!source) return null;
    const versions = array(source.versions);
    return versions.find((version) => String(version.id) === String(evidence && evidence.source_version)) || versions.at(-1) || null;
  }
  function relationsFor(proposition) {
    const propositionId = String(idOf(proposition));
    return state.relations.filter((relation) => String(relation.from_id) === propositionId || String(relation.to_id) === propositionId);
  }
  function hasConfirmedContradiction(proposition) {
    return relationsFor(proposition).some((relation) => relation.type === "contradicts" && relation.status === "confirmed");
  }
  function isReady(proposition) {
    const evidence = evidenceOf(proposition);
    return reviewOf(proposition).status === "approved"
      && publicationOf(proposition).status !== "published"
      && evidence.some((item) => item.status === "exact");
  }

  function counts() {
    const pendingPropositions = state.propositions.filter((item) => reviewOf(item).status === "pending").length;
    const pendingNotes = state.notes.filter((item) => reviewOf(item).status === "pending").length;
    const failedJobs = state.jobs.filter((item) => item.status === "failed" || item.status === "interrupted").length;
    const readyPropositions = state.propositions.filter(isReady).length;
    const readyNotes = state.notes.filter((item) => reviewOf(item).status === "approved" && publicationOf(item).status !== "published").length;
    const published = state.propositions.filter((item) => publicationOf(item).status === "published").length
      + state.notes.filter((item) => publicationOf(item).status === "published").length;
    return { review: pendingPropositions + pendingNotes, failure: failedJobs, ready: readyPropositions + readyNotes, readyPropositions, readyNotes, published };
  }

  function renderCounts() {
    const result = counts();
    const previewCounts = state.preview && state.preview.counts || {};
    const outlineCount = Number(previewCounts.outline_propositions ?? result.readyPropositions) || 0;
    const noteCount = Number(previewCounts.notes ?? result.readyNotes) || 0;
    const gameCount = Number(previewCounts.game_additions) || 0;
    const reusedCount = Number(previewCounts.game_reused) || 0;
    const excludedCount = Number(previewCounts.game_excluded) || 0;
    $("#count-review").textContent = String(result.review);
    $("#count-failure").textContent = String(result.failure);
    $("#count-ready").textContent = String(result.ready);
    $("#count-published").textContent = String(result.published);
    $("#publish-proposition-count").textContent = String(outlineCount);
    $("#publish-note-count").textContent = String(noteCount);
    $("#publish-game-count").textContent = String(gameCount);
    $("#publish-excluded-count").textContent = String(excludedCount);
    const previewError = $("#preview-error");
    if (state.previewError) showError(previewError, `Preview needs attention: ${state.previewError}`);
    else clearError(previewError);
    const previewTotal = outlineCount + noteCount;
    $("#publication-summary").textContent = previewTotal
      ? `${previewTotal} approved ${previewTotal === 1 ? "item" : "items"} will enter the Living Outline. ${gameCount} statements supply Workshop practice; ${reusedCount} reuse existing game knowledge and its schedule.`
      : state.publications.length
        ? "Publish an empty reviewed outline to withdraw its previous notes or outline-only claims. Game references still require reconciliation."
        : "Nothing is approved for the next publication yet.";
    $("#publish-button").disabled = Boolean(state.previewError) || (previewTotal === 0 && state.publications.length === 0);
  }

  function jobProgress(job) {
    const progress = job && job.progress;
    if (typeof progress === "number") return progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
    if (progress && typeof progress === "object") {
      if (typeof progress.percent === "number") return progress.percent <= 1 ? Math.round(progress.percent * 100) : Math.round(progress.percent);
      if (Number(progress.current) >= 0 && Number(progress.total) > 0) return Math.round((Number(progress.current) / Number(progress.total)) * 100);
      if (Number(progress.completed) >= 0 && Number(progress.total) > 0) return Math.round((Number(progress.completed) / Number(progress.total)) * 100);
    }
    return job && job.status === "completed" ? 100 : 0;
  }

  function jobLabel(job) {
    const source = state.sources.find((item) => String(item.id) === String(job.source_id));
    return value(job.title || (source && source.title), `Extraction ${idOf(job) || "job"}`);
  }

  function renderJobsAndSources() {
    $("#source-total").textContent = String(state.sources.length);
    const jobList = $("#job-list");
    const sourceList = $("#source-list");

    const jobs = state.jobs.slice().sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
    replaceChildren(jobList, jobs.length ? jobs.map((job) => {
      const progress = Math.max(0, Math.min(100, jobProgress(job)));
      const canRun = ["queued", "interrupted", "failed"].includes(job.status);
      const runLabel = job.status === "queued" ? "Start" : job.status === "failed" ? "Retry" : "Resume";
      return node("article", { className: "job-item" }, [
        node("div", { className: "item-topline" }, [node("h4", { className: "item-title", text: jobLabel(job) }), statusBadge(job.status)]),
        node("p", { className: "item-detail", text: value(job.stage || (job.progress && job.progress.message), `Job ${idOf(job) || ""}`) }),
        job.error ? node("p", { className: "job-error", text: `Needs attention: ${value(job.error.message || job.error)}` }) : null,
        node("div", { className: "job-actions" }, [
          node("progress", { className: "progress-track", "aria-label": `${jobLabel(job)} progress`, max: "100", value: progress }),
          canRun ? node("button", { className: "button button-secondary button-small", type: "button", text: runLabel, onclick: () => runJob(job) }) : node("span", { className: "item-detail", text: `${progress}%` }),
        ]),
      ]);
    }) : [node("p", { className: "item-detail", text: "No extraction work is waiting." })]);

    replaceChildren(sourceList, state.sources.length ? state.sources.map((source) => {
      const latest = array(source.versions).at(-1);
      return node("article", { className: "source-item" }, [
        node("div", { className: "item-topline" }, [node("h4", { className: "item-title", text: value(source.title, "Untitled source") }), statusBadge(source.kind || "document")]),
        node("p", { className: "item-detail", text: value(source.uri, source.id) }),
        latest ? node("p", { className: "item-detail", text: `Snapshot ${truncate(latest.sha256 || latest.id, 22)} · ${humanize(latest.currency && latest.currency.status || "unverified")}` }) : null,
      ]);
    }) : [node("p", { className: "item-detail", text: "Imported sources will appear here with their immutable snapshots." })]);
  }

  function flagged(proposition) {
    return evidenceOf(proposition).some((evidence) => evidence.status !== "exact")
      || (proposition.confidence && ["unsupported", "contested"].includes(proposition.confidence.support))
      || hasConfirmedContradiction(proposition)
      || reviewOf(proposition).status === "rejected";
  }

  function renderKnowledge() {
    const pending = state.propositions.filter((item) => reviewOf(item).status === "pending").length;
    const approved = state.propositions.filter((item) => reviewOf(item).status === "approved").length;
    const flaggedCount = state.propositions.filter(flagged).length;
    $("#filter-all-count").textContent = String(state.propositions.length);
    $("#filter-pending-count").textContent = String(pending);
    $("#filter-approved-count").textContent = String(approved);
    $("#filter-flagged-count").textContent = String(flaggedCount);

    const query = state.query.trim().toLocaleLowerCase();
    const filtered = state.propositions.filter((proposition) => {
      const matchesFilter = state.filter === "all"
        || (state.filter === "pending" && reviewOf(proposition).status === "pending")
        || (state.filter === "approved" && reviewOf(proposition).status === "approved")
        || (state.filter === "flagged" && flagged(proposition));
      const haystack = [proposition.statement, proposition.node_id, proposition.kind, idOf(proposition)].filter(Boolean).join(" ").toLocaleLowerCase();
      return matchesFilter && (!query || haystack.includes(query));
    });

    const target = $("#knowledge-list");
    if (!filtered.length) {
      replaceChildren(target, [node("div", { className: "empty-state" }, [
        node("span", { className: "empty-glyph", "aria-hidden": "true", text: "⌕" }),
        node("h4", { text: state.propositions.length ? "No statements match" : "No extracted knowledge yet" }),
        node("p", { text: state.propositions.length ? "Adjust the filter or search phrase." : "Import a source and start its extraction when you are ready." }),
      ])]);
      return;
    }

    replaceChildren(target, filtered.map((proposition) => {
      const evidence = evidenceOf(proposition);
      const source = evidence.length ? sourceForEvidence(evidence[0]) : null;
      const selected = state.selected && state.selected.type === "proposition" && String(state.selected.id) === String(idOf(proposition));
      const support = proposition.confidence && proposition.confidence.support || (evidence.some((item) => item.status === "exact") ? "source_supported" : "unsupported");
      const quoteAwaitingReview = reviewOf(proposition).status === "pending" && evidence.some((item) => item.status === "exact");
      return node("article", { className: `knowledge-card${selected ? " is-selected" : ""}` }, [
        node("div", { className: "meta-line" }, [
          node("span", { className: "node-label", text: nodeTitle(proposition.node_id) }),
          statusBadge(reviewOf(proposition).status),
          proposition.kind === "interpretation"
            ? statusBadge("interpretation")
            : quoteAwaitingReview
              ? statusBadge("quote_verified", "", "Quote verified · awaiting review")
              : statusBadge(support),
          publicationOf(proposition).status === "published" ? statusBadge("published") : null,
        ]),
        node("p", { className: "knowledge-statement", text: value(proposition.statement, "Statement unavailable") }),
        node("div", { className: "knowledge-foot" }, [
          node("p", { className: "evidence-summary", text: evidence.length ? `${evidence.length} evidence ${evidence.length === 1 ? "record" : "records"}${source ? ` · ${source.title || source.id}` : ""}` : "No evidence attached" }),
          node("button", { className: "inspect-button", type: "button", text: selected ? "Inspecting →" : "Inspect evidence →", onclick: () => selectItem("proposition", idOf(proposition)) }),
        ]),
      ]);
    }));
  }

  function nodeTitle(nodeId) {
    const found = state.catalog.nodes.find((item) => String(item.id) === String(nodeId));
    return value(found && found.title, nodeId ? `Node · ${nodeId}` : "Unassigned");
  }

  function renderNotes() {
    const target = $("#note-list");
    if (!state.notes.length) { replaceChildren(target, []); return; }
    replaceChildren(target, [
      node("p", { className: "eyebrow", text: "Saved personal drafts" }),
      ...state.notes.map((note) => node("article", { className: "note-item" }, [
        node("div", { className: "item-topline" }, [node("h4", { className: "item-title", text: truncate(note.text, 68) }), statusBadge(reviewOf(note).status)]),
        node("p", { className: "item-detail", text: `${nodeTitle(note.node_id)} · ${value(note.attribution && note.attribution.creator, "Personal")}` }),
        node("button", { className: "inspect-button", type: "button", text: "Review note →", onclick: () => selectItem("note", idOf(note)) }),
      ])),
    ]);
  }

  function evidenceLocator(evidence) {
    const locator = evidence && evidence.locator || {};
    const pieces = [];
    if (locator.section) pieces.push(`Section ${locator.section}`);
    if (locator.line_start) pieces.push(`Line${locator.line_end && locator.line_end !== locator.line_start ? "s" : ""} ${locator.line_start}${locator.line_end && locator.line_end !== locator.line_start ? `–${locator.line_end}` : ""}`);
    const start = formatSeconds(locator.t_start);
    const end = formatSeconds(locator.t_end);
    if (start) pieces.push(`Time ${start}${end ? `–${end}` : ""}`);
    if (array(locator.segment_ids).length) pieces.push(`Segments ${locator.segment_ids.join(", ")}`);
    return pieces.join(" · ") || "Locator not recorded";
  }

  function evidenceCard(evidence) {
    const enriched = state.evidenceDetails.get(String(evidence.id));
    const detail = enriched && typeof enriched === "object" ? { ...evidence, ...enriched, locator: { ...(evidence.locator || {}), ...(enriched.locator || {}) } } : evidence;
    const source = sourceForEvidence(detail);
    const version = versionForEvidence(source, detail);
    const path = detail.source_path || detail.uri || (source && source.uri) || (version && version.source_ref);
    const checksum = detail.sha256 || (version && version.sha256) || detail.source_version;
    const validation = detail.validation || {};
    return node("article", { className: "evidence-card" }, [
      node("div", { className: "item-topline" }, [
        node("strong", { className: "item-title", text: value(source && source.title, detail.source_id || "Source evidence") }),
        statusBadge(detail.status),
      ]),
      node("blockquote", { className: "quote", text: value(detail.quote, "No quote recorded") }),
      node("dl", { className: "evidence-meta" }, [
        meta("Source path", path),
        meta("Location", evidenceLocator(detail)),
        meta("Version", detail.source_version),
        meta("Checksum", checksum),
        meta("Source date", version && version.as_of),
        meta("Imported", version && version.imported_at ? formatDate(version.imported_at) : null),
        meta("Validated", validation.checked_at ? formatDate(validation.checked_at) : value(validation.method)),
        validation.reason ? meta("Finding", validation.reason) : null,
      ]),
    ]);
  }

  function meta(label, content) {
    return node("div", {}, [node("dt", { text: label }), node("dd", { text: value(content) })]);
  }

  function truthData(proposition) {
    const firstEvidence = evidenceOf(proposition)[0];
    const source = firstEvidence && sourceForEvidence(firstEvidence);
    const version = firstEvidence && versionForEvidence(source, firstEvidence);
    const confidence = proposition.confidence || {};
    const quoteAwaitingReview = reviewOf(proposition).status === "pending" && evidenceOf(proposition).some((item) => item.status === "exact");
    return {
      authority: { value: source && source.authority && (source.authority.label || source.authority.level), detail: source && source.authority && source.authority.level },
      currency: { value: version && version.currency && version.currency.status, detail: version && version.currency && version.currency.note },
      support: quoteAwaitingReview
        ? { value: "Quote verified", detail: "Awaiting attributed review" }
        : { value: confidence.support, detail: confidence.explanation },
    };
  }

  function renderPropositionInspector(proposition) {
    $("#inspector-title").textContent = "Statement evidence";
    const evidence = evidenceOf(proposition);
    const truth = truthData(proposition);
    const review = reviewOf(proposition);
    const relationships = relationsFor(proposition);
    const otherPropositions = state.propositions.filter((item) => String(idOf(item)) !== String(idOf(proposition)));
    const kindIsInterpretation = proposition.kind === "interpretation";

    const body = node("div", { className: "inspector-body" }, [
      node("div", { className: "meta-line" }, [statusBadge(review.status), statusBadge(publicationOf(proposition).status), statusBadge(proposition.kind || "supported_proposition")]),
      node("p", { className: "node-label", text: `${nodeTitle(proposition.node_id)} · ${value(proposition.node_id, "No topic ID")}` }),
      node("p", { className: "inspector-statement", text: value(proposition.statement, "Statement unavailable") }),
      node("p", { className: `kind-callout${kindIsInterpretation ? "" : " supported"}`, text: kindIsInterpretation
        ? "Generated interpretation. Review can approve its usefulness, but it remains an interpretation and does not become a source-supported proposition."
        : "Supported proposition. Publication still depends on attributed review, exact evidence, currency, and any unresolved relationships." }),
      node("div", { className: "truth-grid" }, [
        truthCell("Authority", truth.authority.value, truth.authority.detail || "Source classification"),
        truthCell("Currency", truth.currency.value, truth.currency.detail || "Currentness is separate from checksum"),
        truthCell("Support", truth.support.value, truth.support.detail || "Evidence assessment"),
      ]),
      topicAssignmentSection(proposition),
      revisionSection(proposition),
      node("section", { className: "inspector-section" }, [
        node("h4", {}, ["Exact source", node("span", { className: "section-count", text: `${evidence.length} ${evidence.length === 1 ? "record" : "records"}` })]),
        ...(evidence.length ? evidence.map(evidenceCard) : [node("p", { className: "item-detail", text: "No evidence has been attached. This statement cannot be published as source-supported." })]),
      ]),
      assessmentSection(proposition),
      reviewSection("proposition", proposition),
      correctionHistorySection(proposition),
      gameMatchSection(proposition),
      node("section", { className: "inspector-section" }, [
        node("h4", {}, ["Relationships", node("span", { className: "section-count", text: `${relationships.length} recorded` })]),
        node("div", { className: "relationship-list" }, relationships.length ? relationships.map((relation) => relationshipItem(relation, proposition)) : [node("p", { className: "item-detail", text: "No contradictions, supersessions, or other relationships recorded." })]),
        otherPropositions.length ? relationshipForm(proposition, otherPropositions) : null,
      ]),
    ]);
    replaceChildren($("#inspector-content"), [body]);
    evidence.forEach(loadEvidenceDetail);
  }

  function truthCell(label, main, detail) {
    return node("div", { className: "truth-cell" }, [node("span", { text: label }), node("strong", { text: humanize(main) }), node("small", { text: value(detail) })]);
  }

  function gameMatchSection(proposition) {
    const matches = state.gameMatches.filter((match) => match.proposition_id === idOf(proposition));
    return node("section", { className: "inspector-section game-matches" }, [
      node("h4", { text: "Existing game knowledge" }),
      node("p", { className: "item-detail", text: "Compare conditions and scope before confirming a match. A confirmed match keeps the existing fact and its learning schedule; your new source remains in the outline. Previously published duplicate IDs remain in history and leave practice." }),
      state.gameMatchesError ? node("p", { className: "form-error", text: state.gameMatchesError }) : null,
      ...matches.map((match, index) => {
        const review = match.review || {};
        const prefix = `game-match-${index}`;
        const form = node("form", { className: "review-form" }, [
          node("label", { for: `${prefix}-by`, text: "Match reviewer" }),
          node("input", { id: `${prefix}-by`, name: "by", value: value(review.by, "Local editor"), required: "true" }),
          node("label", { for: `${prefix}-method`, text: "Match review method" }),
          node("select", { id: `${prefix}-method`, name: "method" }, [node("option", { value: "human", text: "Human" }), node("option", { value: "agent", text: "Agent" })]),
          node("label", { for: `${prefix}-note`, text: "Reason for this match decision" }),
          node("textarea", { id: `${prefix}-note`, name: "note", rows: "2", required: "true", text: review.note || "" }),
          node("p", { className: "form-error", role: "alert", hidden: "true" }),
          node("div", { className: "review-actions" }, [
            node("button", { className: "button button-primary", type: "submit", text: "Confirm same knowledge", disabled: !match.fact, dataset: { status: "confirmed" } }),
            node("button", { className: "button button-secondary", type: "submit", text: "Dismiss match", dataset: { status: "dismissed" } }),
          ]),
        ]);
        form.elements.method.value = review.method || "human";
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const errorTarget = form.querySelector(".form-error");
          clearError(errorTarget);
          const data = Object.fromEntries(new FormData(form));
          const buttons = [...form.querySelectorAll("button")];
          buttons.forEach((button) => { button.disabled = true; });
          try {
            await request(`/api/workshop/propositions/${encodeURIComponent(idOf(proposition))}/game-link`, { method: "POST", body: {
              ...data, pack_id: match.pack_id, fact_id: match.fact_id,
              fact_sha256: match.fact_sha256, proposition_sha256: match.proposition_sha256,
              status: event.submitter.dataset.status,
            } });
            toast("Game match review recorded.");
            await loadWorkspace({ quiet: true });
          } catch (error) { showError(errorTarget, error); }
          finally { buttons.forEach((button) => { button.disabled = false; }); }
        });
        return node("article", { className: "relationship-item", dataset: { factId: match.fact_id } }, [
          node("div", { className: "item-topline" }, [statusBadge(match.stale ? "needs_review" : review.status || "suggested"), node("span", { text: match.reason })]),
          node("strong", { text: "Imported claim" }),
          node("p", { text: proposition.statement }),
          node("strong", { text: "Existing game fact" }),
          node("p", { className: "node-label", text: `${match.pack_id} · ${match.fact_id}` }),
          node("p", { text: match.fact ? match.fact.statement : "The previous target is no longer in the selected pack." }),
          match.fact ? node("blockquote", { text: match.fact.source_ref.quote }) : null,
          match.fact ? node("p", { className: "item-detail", text: `${match.fact.source_ref.file} · ${match.fact.source_ref.loc}` }) : null,
          review.by ? node("p", { className: "review-history", text: `${review.status} by ${review.by} (${review.method}): ${review.note}` }) : null,
          match.stale ? node("p", { className: "form-error", text: "The claim or canonical fact changed. This prior decision cannot authorize publication until reviewed again." }) : null,
          form,
        ]);
      }),
      !matches.length && !state.gameMatchesError ? node("p", { className: "item-detail", text: "No close wording matches found in the selected base pack. Matching is advisory and may miss paraphrases." }) : null,
    ]);
  }

  function topicAssignmentSection(proposition) {
    const form = node("form", { className: "topic-form" }, [
      node("label", { for: "inspector-topic", text: "Outline topic" }),
      node("select", { id: "inspector-topic", name: "node_id", required: "true", disabled: state.catalog.nodes.length === 0 }, state.catalog.nodes.length
        ? state.catalog.nodes.map((item) => node("option", { value: item.id, text: `${item.title} · ${item.id}` }))
        : [node("option", { value: "", text: "Topic catalog unavailable" })]),
      node("label", { for: "inspector-topic-by", text: "Changed by" }),
      node("input", { id: "inspector-topic-by", name: "by", value: "Local editor", required: "true" }),
      node("label", { for: "inspector-topic-note", text: "Reason for correction" }),
      node("textarea", { id: "inspector-topic-note", name: "note", rows: "2", placeholder: "Why does this statement belong in the new topic?", required: "true" }),
      node("p", { className: "item-detail", text: "Changing the topic preserves the statement ID and returns it to pending review." }),
      node("p", { className: "form-error", role: "alert", hidden: "true" }),
      node("button", { className: "button button-secondary button-wide", type: "submit", text: "Correct topic", disabled: state.catalog.nodes.length === 0 }),
    ]);
    const select = form.elements.node_id;
    if (state.catalog.nodes.some((item) => String(item.id) === String(proposition.node_id))) select.value = proposition.node_id;
    form.addEventListener("submit", (event) => submitTopicAssignment(event, proposition));
    return node("details", { className: "inspector-section correction-section topic-correction-section" }, [
      node("summary", { text: "Correct outline topic" }),
      form,
    ]);
  }

  function revisionSection(proposition) {
    const evidence = evidenceOf(proposition);
    const statementId = "inspector-revision-statement";
    const typeId = "inspector-revision-type";
    const detailId = "inspector-revision-detail";
    const evidenceId = "inspector-revision-evidence";
    const quoteId = "inspector-revision-quote";
    const byId = "inspector-revision-by";
    const noteId = "inspector-revision-note";
    const relationId = "inspector-revision-relation";
    const form = node("form", { className: "revision-form" }, [
      node("label", { for: statementId, text: "Corrected statement" }),
      node("textarea", { id: statementId, name: "statement", rows: "3", required: "true" }, [value(proposition.statement, "")]),
      node("label", { for: typeId, text: "Knowledge type" }),
      node("select", { id: typeId, name: "proposition_type" }, ["rule", "concept", "advice", "do", "dont", "number", "story"].map((item) => node("option", { value: item, text: humanize(item) }))),
      node("label", { for: detailId, text: "Corrected detail (optional)" }),
      node("textarea", { id: detailId, name: "detail", rows: "2", placeholder: "Add only detail supported by the selected exact quote." }),
      node("label", { for: evidenceId, text: "Existing evidence" }),
      node("select", { id: evidenceId, name: "evidence_id", required: "true", disabled: evidence.length === 0 }, evidence.length
        ? evidence.map((item) => node("option", { value: item.id, text: `${truncate(item.quote, 62)} · ${item.id}` }))
        : [node("option", { value: "", text: "No evidence available" })]),
      node("label", { for: quoteId, text: "Exact quote" }),
      node("textarea", { id: quoteId, name: "quote", rows: "3", required: "true", disabled: evidence.length === 0 }, [value(evidence[0] && evidence[0].quote, "")]),
      node("div", { className: "split-fields" }, [
        node("div", {}, [
          node("label", { for: relationId, text: "Correction relation" }),
          node("select", { id: relationId, name: "relation_type" }, [
            node("option", { value: "refines", text: "Refines" }),
            node("option", { value: "supersedes", text: "Supersedes" }),
          ]),
        ]),
        node("div", {}, [
          node("label", { for: byId, text: "Proposed by" }),
          node("input", { id: byId, name: "by", value: "Local editor", required: "true" }),
        ]),
      ]),
      node("label", { for: noteId, text: "Reason for correction" }),
      node("textarea", { id: noteId, name: "note", rows: "2", placeholder: "What does this correction fix?", required: "true" }),
      node("p", { className: "revision-note", text: "The original statement remains unchanged. The correction becomes a separate pending proposal linked to it." }),
      node("p", { className: "form-error", role: "alert", hidden: "true" }),
      node("button", { className: "button button-secondary button-wide", type: "submit", text: "Propose correction", disabled: evidence.length === 0 }),
    ]);
    form.elements.proposition_type.value = ["rule", "concept", "advice", "do", "dont", "number", "story"].includes(proposition.type)
      ? proposition.type
      : "concept";
    form.elements.evidence_id.addEventListener("change", () => {
      const selectedEvidence = evidence.find((item) => String(item.id) === String(form.elements.evidence_id.value));
      form.elements.quote.value = value(selectedEvidence && selectedEvidence.quote, "");
    });
    form.addEventListener("submit", (event) => submitRevision(event, proposition));
    return node("details", { className: "inspector-section correction-section revision-section" }, [
      node("summary", { text: "Propose correction" }),
      form,
    ]);
  }

  function correctionHistorySection(proposition) {
    const revisions = relationsFor(proposition).filter((relation) => ["refines", "supersedes"].includes(relation.type));
    if (!revisions.length) return null;
    return node("section", { className: "inspector-section correction-history" }, [
      node("h4", {}, ["Correction history", node("span", { className: "section-count", text: `${revisions.length} linked` })]),
      ...revisions.map((relation) => {
        const before = state.propositions.find((item) => String(idOf(item)) === String(relation.to_id));
        const after = state.propositions.find((item) => String(idOf(item)) === String(relation.from_id));
        const receipt = array(after && after.revision_history).find((item) => String(item.relation_id) === String(relation.id));
        return node("article", { className: "correction-history-item" }, [
          node("div", { className: "item-topline" }, [statusBadge(relation.type), statusBadge(relation.status)]),
          node("div", { className: "correction-comparison" }, [
            correctionSide("Before · original", before, relation.to_id),
            correctionSide("After · proposal", after, relation.from_id),
          ]),
          relation.note ? node("p", { className: "item-detail", text: `${value(relation.by, "Unattributed")}: ${relation.note}` }) : null,
          receipt ? node("dl", { className: "assessment-meta correction-meta" }, [
            meta("Method", receipt.method),
            meta("Recorded", receipt.at ? formatDate(receipt.at) : null),
            meta("Source evidence", receipt.source_evidence_id),
            meta("Proposal evidence", receipt.evidence_id),
          ]) : null,
        ]);
      }),
    ]);
  }

  function correctionSide(label, proposition, propositionId) {
    return node("div", { className: "correction-side" }, [
      node("span", { text: label }),
      proposition ? statusBadge(reviewOf(proposition).status) : null,
      node("p", { text: value(proposition && proposition.statement, propositionId) }),
      node("button", { className: "relationship-link", type: "button", text: "Inspect statement →", onclick: () => selectItem("proposition", propositionId) }),
    ]);
  }

  function assessmentSection(proposition) {
    const assessments = array(proposition.assessments);
    if (!assessments.length) return null;
    return node("section", { className: "inspector-section" }, [
      node("h4", {}, ["AI assessments", node("span", { className: "section-count", text: `${assessments.length} advisory` })]),
      node("p", { className: "assessment-caveat", text: "These model assessments may inform an attributed review. They are advisory and do not approve a statement." }),
      node("div", { className: "assessment-list" }, assessments.map((assessment) => {
        const advisory = assessment && assessment.semantic_assessment && typeof assessment.semantic_assessment === "object"
          ? assessment.semantic_assessment
          : assessment;
        return node("article", { className: "assessment-item" }, [
        node("div", { className: "item-topline" }, [
          statusBadge(advisory.verdict || "assessment"),
          node("span", { className: "assessment-model", text: value(advisory.model, "Model not recorded") }),
        ]),
        advisory.reason ? node("p", { text: advisory.reason }) : null,
        advisory.note ? node("p", { className: "item-detail", text: advisory.note }) : null,
        node("dl", { className: "assessment-meta" }, [
          meta("Backend", advisory.backend),
          meta("Method", advisory.method),
          meta("Advisory ID", advisory.id),
          meta("Checked", advisory.checked_at ? formatDate(advisory.checked_at) : null),
          meta("Receipt", advisory.receipt_dir),
          meta("Assessment ID", assessment.id),
          meta("Job", assessment.job_id),
          meta("Chunk", assessment.chunk_index),
          meta("Source", assessment.source_id),
          meta("Version", assessment.source_version),
          meta("Evidence", assessment.evidence_id),
          meta("Recorded", assessment.created_at ? formatDate(assessment.created_at) : null),
        ]),
      ]);
      })),
    ]);
  }

  function reviewSection(type, item) {
    const review = reviewOf(item);
    const reviewerId = `inspector-${type}-reviewer`;
    const methodId = `inspector-${type}-review-method`;
    const noteId = `inspector-${type}-review-note`;
    const form = node("form", { className: "review-form" }, [
      node("label", { for: reviewerId, text: "Reviewer" }),
      node("input", { id: reviewerId, name: "by", value: value(review.by, "Local editor"), required: "true", autocomplete: "name" }),
      node("label", { for: methodId, text: "Review method" }),
      node("select", { id: methodId, name: "method" }, [
        node("option", { value: "human", text: "Human" }),
        node("option", { value: "agent", text: "Agent" }),
      ]),
      node("label", { for: noteId, text: "Review note" }),
      node("textarea", { id: noteId, name: "note", rows: "3", placeholder: "Record the reason for this decision…" }),
      node("p", { className: "item-detail", text: "This decision will be recorded with the selected method and reviewer attribution." }),
      node("p", { className: "form-error", role: "alert", hidden: "true" }),
      node("div", { className: "review-actions" }, [
        node("button", { className: "button button-primary", type: "submit", text: "Approve", dataset: { status: "approved" } }),
        node("button", { className: "button button-danger", type: "submit", text: "Reject", dataset: { status: "rejected" } }),
      ]),
    ]);
    form.elements.method.value = ["human", "agent"].includes(review.method) ? review.method : "human";
    form.addEventListener("submit", (event) => submitReview(event, type, item));
    return node("section", { className: "inspector-section" }, [
      node("h4", { text: "Attributed review" }),
      review.status !== "pending" ? node("p", { className: "review-history", text: `${humanize(review.status)} by ${value(review.by)} on ${formatDate(review.at)}${review.note ? ` — ${review.note}` : ""}. Method: ${value(review.method)}.` }) : null,
      form,
    ]);
  }

  function relationshipItem(relation, proposition) {
    const propositionIsFrom = String(relation.from_id) === String(idOf(proposition));
    const relatedId = propositionIsFrom ? relation.to_id : relation.from_id;
    const related = state.propositions.find((item) => String(idOf(item)) === String(relatedId));
    return node("article", { className: "relationship-item" }, [
      node("div", { className: "item-topline" }, [statusBadge(relation.type), statusBadge(relation.status)]),
      node("p", {}, [
        `${propositionIsFrom ? "Points to" : "Comes from"}: `,
        node("button", { className: "relationship-link", type: "button", text: truncate(related && related.statement || relatedId, 100), onclick: () => selectItem("proposition", relatedId) }),
      ]),
      relation.note ? node("p", { text: `${value(relation.by, "Unattributed")}: ${relation.note}` }) : null,
    ]);
  }

  function relationshipForm(proposition, options) {
    const targetId = "relation-target";
    const typeId = "relation-type";
    const statusId = "relation-status";
    const byId = "relation-author";
    const noteId = "relation-note";
    const form = node("form", { className: "relation-form" }, [
      node("label", { for: targetId, text: "Record a relationship" }),
      node("select", { id: targetId, name: "to_id", required: "true" }, options.map((item) => node("option", { value: idOf(item), text: truncate(item.statement, 74) }))),
      node("div", { className: "split-fields" }, [
        node("div", {}, [node("label", { for: typeId, text: "Relationship" }), node("select", { id: typeId, name: "type" }, ["contradicts", "supersedes", "refines", "related", "duplicate_of"].map((item) => node("option", { value: item, text: humanize(item) })))]),
        node("div", {}, [node("label", { for: statusId, text: "Finding" }), node("select", { id: statusId, name: "status" }, ["proposed", "confirmed", "dismissed"].map((item) => node("option", { value: item, text: humanize(item) })))]),
      ]),
      node("label", { for: byId, text: "Recorded by" }),
      node("input", { id: byId, name: "by", value: "Local editor", required: "true" }),
      node("label", { for: noteId, text: "Relationship note" }),
      node("textarea", { id: noteId, name: "note", rows: "2", placeholder: "Why are these statements related?" }),
      node("p", { className: "form-error", role: "alert", hidden: "true" }),
      node("button", { className: "button button-secondary button-wide", type: "submit", text: "Record relationship" }),
    ]);
    form.addEventListener("submit", (event) => submitRelationship(event, proposition));
    return form;
  }

  function renderNoteInspector(note) {
    $("#inspector-title").textContent = "Personal note";
    const attribution = note.attribution || {};
    const body = node("div", { className: "inspector-body" }, [
      node("div", { className: "meta-line" }, [statusBadge("personal"), statusBadge(reviewOf(note).status), statusBadge(publicationOf(note).status)]),
      node("p", { className: "node-label", text: nodeTitle(note.node_id) }),
      node("p", { className: "inspector-statement", text: value(note.text, "Note unavailable") }),
      node("p", { className: "kind-callout", text: "Personal layer. This note may be reviewed and published with attribution, but it does not claim external authority or become controlling source text." }),
      node("dl", { className: "evidence-meta" }, [
        meta("Author", attribution.creator),
        meta("Layer", attribution.layer_id),
        meta("Created", formatDate(note.created_at)),
        meta("Updated", formatDate(note.updated_at)),
      ]),
      reviewSection("note", note),
    ]);
    replaceChildren($("#inspector-content"), [body]);
  }

  function renderInspector() {
    if (!state.selected) return;
    const list = state.selected.type === "note" ? state.notes : state.propositions;
    const item = list.find((candidate) => String(idOf(candidate)) === String(state.selected.id));
    if (!item) {
      state.selected = null;
      $("#inspector-title").textContent = "Select a statement";
      replaceChildren($("#inspector-content"), [node("div", { className: "empty-state inspector-empty" }, [node("span", { className: "empty-glyph", text: "⌘", "aria-hidden": "true" }), node("h4", { text: "Evidence stays attached" }), node("p", { text: "Choose a statement to inspect its source, exact quote, review history, and relationships." })])]);
      return;
    }
    if (state.selected.type === "note") renderNoteInspector(item);
    else renderPropositionInspector(item);
  }

  function selectItem(type, id) {
    state.selected = { type, id };
    renderKnowledge();
    renderInspector();
    const inspector = $("#inspector");
    inspector.classList.add("is-open");
    if (window.innerWidth < 1200) window.setTimeout(() => $("#inspector-title").focus(), 0);
  }

  async function loadEvidenceDetail(evidence) {
    if (!evidence || !evidence.id || state.evidenceDetails.has(String(evidence.id))) return;
    state.evidenceDetails.set(String(evidence.id), null);
    try {
      const detail = await request(`/api/workshop/evidence/${encodeURIComponent(evidence.id)}`);
      state.evidenceDetails.set(String(evidence.id), detail.evidence || detail);
    } catch {
      state.evidenceDetails.set(String(evidence.id), false);
    }
  }

  function renderPublicationResult() {
    const target = $("#publication-result");
    const latest = state.publications.at(-1);
    if (!latest) { replaceChildren(target, []); return; }
    const outlineUrl = safeLocalHref(latest.outline_url, "/workshop/published/outline.json");
    const packUrl = safeLocalHref(latest.pack_url, "/workshop/published/pack.json");
    const nodeId = state.selected && state.selected.type === "proposition"
      ? (state.propositions.find((item) => String(idOf(item)) === String(state.selected.id)) || {}).node_id
      : "";
    replaceChildren(target, [
      node("p", { className: "item-detail", text: `Latest release ${value(latest.publication_id || latest.id, "available")} · ${formatDate(latest.generated_at || latest.created_at)}` }),
      node("a", { href: nodeId ? `/app/#node=${encodeURIComponent(nodeId)}` : "/app/", text: "Open in Living Outline ↗" }),
      node("a", { href: outlineUrl, text: "Inspect published outline ↗" }),
      node("a", { href: packUrl, text: "Inspect game pack ↗" }),
    ]);
  }

  function renderAll() {
    renderCounts();
    renderJobsAndSources();
    renderKnowledge();
    renderNotes();
    renderInspector();
    renderPublicationResult();
  }

  async function importSource(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorTarget = $("#import-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    const payload = Object.fromEntries(Object.entries(data).filter(([, item]) => String(item).trim() !== ""));
    if (!payload.path && !payload.catalog_key) {
      showError(errorTarget, "Choose a catalog source or enter a local path.");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Preparing source…";
    try {
      const result = await request("/api/workshop/import", { method: "POST", body: payload });
      toast(result.duplicate ? "This source is already in the workshop; its existing work was restored." : "Source imported. Start its extraction when ready.");
      await loadWorkspace({ quiet: true });
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.disabled = false;
      button.textContent = "Import and prepare";
    }
  }

  async function runJob(job) {
    const jobId = idOf(job);
    if (!jobId) { toast("This job has no recorded identifier, so it cannot be resumed.", "error"); return; }
    try {
      const result = await request(`/api/workshop/jobs/${encodeURIComponent(jobId)}/run`, { method: "POST", body: {} });
      const updated = result.job || result;
      const index = state.jobs.findIndex((item) => String(idOf(item)) === String(jobId));
      if (index >= 0 && updated && typeof updated === "object") state.jobs[index] = { ...state.jobs[index], ...updated };
      renderAll();
      startPolling(jobId);
      toast(job.status === "queued" ? "Extraction started." : "Extraction resumed from its saved work.");
    } catch (error) {
      toast(`Could not start extraction: ${error.message}`, "error");
      await loadWorkspace({ quiet: true });
    }
  }

  function startPolling(jobId) {
    const key = String(jobId);
    if (state.pollers.has(key)) return;
    const poll = async () => {
      try {
        const result = await request(`/api/workshop/jobs/${encodeURIComponent(jobId)}`);
        const updated = result.job || result;
        const index = state.jobs.findIndex((item) => String(idOf(item)) === key);
        if (index >= 0) state.jobs[index] = { ...state.jobs[index], ...updated };
        else if (updated && typeof updated === "object") state.jobs.push(updated);
        renderJobsAndSources();
        renderCounts();
        if (["queued", "running"].includes(updated.status)) {
          const timer = window.setTimeout(poll, 1600);
          state.pollers.set(key, timer);
        } else {
          state.pollers.delete(key);
          await loadWorkspace({ quiet: true });
          toast(updated.status === "completed" ? "Extraction completed. Its statements are ready for review." : `Extraction ${humanize(updated.status)}. Open its activity card for details.`, updated.status === "completed" ? "success" : "error");
        }
      } catch (error) {
        state.pollers.delete(key);
        toast(`Could not refresh extraction status: ${error.message}`, "error");
      }
    };
    const timer = window.setTimeout(poll, 500);
    state.pollers.set(key, timer);
  }

  function maintainPolling() {
    state.jobs.filter((job) => ["queued", "running"].includes(job.status)).forEach((job) => {
      if (idOf(job)) startPolling(idOf(job));
    });
  }

  async function submitReview(event, type, item) {
    event.preventDefault();
    const form = event.currentTarget;
    const clicked = event.submitter;
    const status = clicked && clicked.dataset.status;
    const errorTarget = form.querySelector(".form-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    if (!data.by || !String(data.by).trim()) { showError(errorTarget, "Enter the reviewer’s name."); return; }
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    const path = type === "note"
      ? `/api/workshop/notes/${encodeURIComponent(idOf(item))}/review`
      : `/api/workshop/propositions/${encodeURIComponent(idOf(item))}/review`;
    try {
      await request(path, { method: "POST", body: { status, by: String(data.by).trim(), note: String(data.note || "").trim(), method: data.method === "agent" ? "agent" : "human" } });
      toast(`${type === "note" ? "Personal note" : "Statement"} ${status}.`);
      await loadWorkspace({ quiet: true });
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function submitTopicAssignment(event, proposition) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorTarget = form.querySelector(".form-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      node_id: String(data.node_id || ""),
      by: String(data.by || "").trim(),
      note: String(data.note || "").trim(),
    };
    if (!payload.node_id || !payload.by || !payload.note) {
      showError(errorTarget, "Choose a topic and record who made the correction and why.");
      return;
    }
    if (String(payload.node_id) === String(proposition.node_id)) {
      showError(errorTarget, "Choose a different topic before recording a correction.");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await request(`/api/workshop/propositions/${encodeURIComponent(idOf(proposition))}/assign`, { method: "POST", body: payload });
      toast("Topic corrected. The statement now needs renewed attributed review.");
      await loadWorkspace({ quiet: true });
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.disabled = false;
    }
  }

  async function submitRevision(event, proposition) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorTarget = form.querySelector(".form-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      statement: String(data.statement || "").trim(),
      detail: String(data.detail || "").trim(),
      proposition_type: ["rule", "concept", "advice", "do", "dont", "number", "story"].includes(data.proposition_type) ? data.proposition_type : "concept",
      quote: String(data.quote || ""),
      evidence_id: String(data.evidence_id || ""),
      by: String(data.by || "").trim(),
      note: String(data.note || "").trim(),
      relation_type: data.relation_type === "supersedes" ? "supersedes" : "refines",
      method: "human",
    };
    if (!payload.statement || !payload.quote || !payload.evidence_id || !payload.by || !payload.note) {
      showError(errorTarget, "Enter the corrected statement, exact quote, attribution, and reason.");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await request(`/api/workshop/propositions/${encodeURIComponent(idOf(proposition))}/revise`, { method: "POST", body: payload });
      await loadWorkspace({ quiet: true });
      if (result.proposed_id) selectItem("proposition", result.proposed_id);
      const exact = array(result.proposition && result.proposition.evidence).some((item) => item.status === "exact");
      if (!exact) toast("Correction saved for inspection, but its quote did not verify. It cannot be approved until exact evidence is supplied.", "error");
      else toast(result.duplicate ? "That correction already exists; its preserved review is open." : "Correction proposed. The original remains unchanged and the proposal awaits attributed review.");
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.disabled = false;
    }
  }

  async function submitRelationship(event, proposition) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorTarget = form.querySelector(".form-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    const payload = { from_id: idOf(proposition), to_id: data.to_id, type: data.type, status: data.status, note: String(data.note || "").trim(), by: String(data.by || "").trim() };
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await request("/api/workshop/relations", { method: "POST", body: payload });
      toast(`${humanize(payload.type)} relationship recorded as ${payload.status}.`);
      await loadWorkspace({ quiet: true });
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.disabled = false;
    }
  }

  async function createNote(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorTarget = $("#note-error");
    clearError(errorTarget);
    const data = Object.fromEntries(new FormData(form));
    const payload = { node_id: data.node_id, text: String(data.text || "").trim(), attribution: { creator: String(data.creator || "").trim(), layer_id: String(data.layer_id || "").trim() } };
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await request("/api/workshop/notes", { method: "POST", body: payload });
      toast("Personal draft saved with its attribution.");
      form.elements.text.value = "";
      await loadWorkspace({ quiet: true });
      const created = result.note || result;
      if (idOf(created)) selectItem("note", idOf(created));
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.disabled = false;
    }
  }

  async function publish() {
    const errorTarget = $("#publish-error");
    clearError(errorTarget);
    const by = $("#publisher-name").value.trim();
    if (!by) { showError(errorTarget, "Enter the publisher’s name."); return; }
    const button = $("#publish-button");
    button.disabled = true;
    button.textContent = "Publishing approved work…";
    try {
      const result = await request("/api/workshop/publish", { method: "POST", body: { by } });
      const publication = { ...(result.publication || {}), outline_url: result.outline_url, pack_url: result.pack_url, counts: result.counts };
      state.publications.push(publication);
      toast("Approved work published. The outline and game pack links are ready.");
      await loadWorkspace({ quiet: true });
      if (!state.publications.length) state.publications.push(publication);
      renderPublicationResult();
    } catch (error) {
      showError(errorTarget, error);
    } finally {
      button.textContent = "Publish approved work";
      renderCounts();
    }
  }

  function bindEvents() {
    $("#import-form").addEventListener("submit", importSource);
    $("#note-form").addEventListener("submit", createNote);
    $("#publish-button").addEventListener("click", publish);
    $("#refresh-button").addEventListener("click", () => Promise.all([loadWorkspace(), loadCatalog()]));
    $("#knowledge-search").addEventListener("input", (event) => { state.query = event.target.value; renderKnowledge(); });
    document.querySelectorAll(".filter-tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;
        document.querySelectorAll(".filter-tab").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        renderKnowledge();
      });
    });
    $("#inspector-close").addEventListener("click", () => $("#inspector").classList.remove("is-open"));
    $("#inspector").addEventListener("click", (event) => {
      if (event.target === $("#inspector")) $("#inspector").classList.remove("is-open");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") $("#inspector").classList.remove("is-open");
    });
    window.addEventListener("beforeunload", () => state.pollers.forEach((timer) => window.clearTimeout(timer)));
  }

  bindEvents();
  renderAll();
  Promise.all([loadWorkspace(), loadCatalog()]);
})();
