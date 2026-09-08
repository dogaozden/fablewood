import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../web");
const [html, css, js] = await Promise.all([
  readFile(resolve(web, "index.html"), "utf8"),
  readFile(resolve(web, "workshop.css"), "utf8"),
  readFile(resolve(web, "workshop.js"), "utf8"),
]);

const source = {
  id: "source.neutral",
  title: "Neutral field reference",
  kind: "document",
  uri: "/fixtures/neutral.txt",
  authority: { level: "secondary", label: "Secondary reference" },
  versions: [{
    id: "sha256:abcd",
    sha256: "abcd1234",
    source_ref: "neutral.txt#part-a",
    currency: { status: "unverified", note: "Edition has not been checked for currency." },
  }],
};
const proposition = {
  id: "proposition.neutral",
  node_id: "node.neutral",
  statement: "The instrument records a result after calibration.",
  kind: "supported_proposition",
  type: "rule",
  detail: "An unsupported inference that must not be copied into a correction.",
  confidence: { support: "source_supported", explanation: "The quote is exact." },
  review: { status: "pending", by: null, at: null, note: "", method: null },
  publication: { status: "draft" },
  evidence: [{
    id: "evidence.neutral",
    source_id: source.id,
    source_version: "sha256:abcd",
    quote: "The instrument records a result after calibration.",
    status: "exact",
    locator: { section: "Part A", line_start: 12, line_end: 12 },
    validation: { method: "exact_snapshot_match", checked_at: "2026-09-07T12:00:00Z" },
  }],
  assessments: [{
    id: "assessment.neutral",
    semantic_assessment: {
      verdict: "accept",
      reason: "The statement follows the quoted sentence.",
      note: "Check its scope.",
      model: "fixture-model",
      method: "independent subscription-CLI assessment",
      checked_at: "2026-09-07T12:01:00Z",
      receipt_dir: "/receipts/job.neutral/assessment",
    },
    job_id: "job.neutral",
    chunk_index: 3,
    source_id: source.id,
    source_version: "sha256:abcd",
    evidence_id: "evidence.neutral",
    created_at: "2026-09-07T12:02:00Z",
  }],
};
const interpretation = {
  id: "proposition.interpretation",
  node_id: "node.neutral",
  statement: "This may suggest a broader pattern.",
  kind: "interpretation",
  confidence: { support: "unsupported", explanation: "No exact quote supports the inference." },
  review: { status: "pending" },
  publication: { status: "draft" },
  evidence: [],
};
const workspace = {
  sources: [source],
  jobs: [{ id: "job.neutral", source_id: source.id, status: "queued", progress: { completed: 0, total: 2 } }],
  propositions: [proposition, interpretation],
  relations: [{ id: "relation.neutral", from_id: proposition.id, to_id: interpretation.id, type: "related", status: "proposed", note: "Editorial suggestion", by: "fixture" }],
  notes: [],
  publications: [],
};
const calls = [];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.route("http://workshop.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/workshop/" || path === "/workshop") return route.fulfill({ contentType: "text/html", body: html });
    if (path === "/workshop/workshop.css") return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/workshop/workshop.js") return route.fulfill({ contentType: "text/javascript", body: js });
    if (path === "/api/workshop" && method === "GET") return route.fulfill({ json: workspace });
    if (path === "/api/workshop/game-matches") return route.fulfill({ json: { pack_id: "neutral", matches: [] } });
    if (path === "/api/workshop/catalog") return route.fulfill({ json: { nodes: [{ id: "node.neutral", title: "Neutral node" }, { id: "node.second", title: "Second neutral node" }], sources: [{ key: "catalog.neutral", title: "Catalog reference", kind: "document", node_id: "node.neutral" }] } });
    if (path === "/api/workshop/preview") {
      const approved = workspace.propositions.filter((item) => item.review.status === "approved").length;
      return route.fulfill({ json: { counts: { outline_propositions: approved, notes: 0, game_additions: approved, game_excluded: 0 } } });
    }
    if (path === "/api/workshop/evidence/evidence.neutral") return route.fulfill({ json: { evidence: proposition.evidence[0], source, version: source.versions[0] } });
    if (path === "/api/workshop/propositions/proposition.neutral/review" && method === "POST") {
      const body = request.postDataJSON();
      calls.push({ path, body });
      proposition.review = { status: body.status, by: body.by, note: body.note, method: body.method, at: "2026-09-07T13:00:00Z" };
      return route.fulfill({ json: { proposition } });
    }
    if (path === "/api/workshop/propositions/proposition.neutral/assign" && method === "POST") {
      const body = request.postDataJSON();
      calls.push({ path, body });
      proposition.node_id = body.node_id;
      proposition.review = { status: "pending", by: null, at: null, note: "", method: null };
      return route.fulfill({ json: { proposition } });
    }
    if (path === "/api/workshop/propositions/proposition.neutral/revise" && method === "POST") {
      const body = request.postDataJSON();
      calls.push({ path, body });
      if (body.quote !== proposition.evidence[0].quote) {
        return route.fulfill({ status: 400, json: { error: "Exact quote does not match the selected evidence." } });
      }
      const proposed = {
        ...structuredClone(proposition),
        id: "proposition.corrected",
        statement: body.statement,
        type: body.proposition_type,
        detail: body.detail,
        review: { status: "pending", by: null, at: null, note: "", method: null },
        publication: { status: "draft" },
        created_at: "2026-09-07T14:00:00Z",
      };
      const relation = {
        id: "relation.correction",
        from_id: proposed.id,
        to_id: proposition.id,
        type: body.relation_type,
        status: "proposed",
        by: body.by,
        note: body.note,
      };
      workspace.propositions.push(proposed);
      workspace.relations.push(relation);
      return route.fulfill({ status: 201, json: { original_id: proposition.id, proposed_id: proposed.id, proposition: proposed, relation, duplicate: false } });
    }
    if (path === "/api/workshop/jobs/job.neutral/run" && method === "POST") {
      workspace.jobs[0] = { ...workspace.jobs[0], status: "running" };
      return route.fulfill({ json: workspace.jobs[0] });
    }
    if (path === "/api/workshop/jobs/job.neutral") return route.fulfill({ json: workspace.jobs[0] });
    if (path === "/api/workshop/import" && method === "POST") return route.fulfill({ status: 422, json: { error: "Choose a readable local source." } });
    return route.fulfill({ status: 404, json: { error: `Unhandled fixture route: ${method} ${path}` } });
  });

  await page.goto("http://workshop.test/workshop/");
  await page.waitForSelector(".knowledge-card");
  assert.equal(await page.locator(".knowledge-card").count(), 2);
  assert.equal(await page.locator("#count-review").textContent(), "2");
  assert.equal(await page.locator("#count-ready").textContent(), "0");
  assert.match(await page.locator(".knowledge-card").first().textContent(), /Neutral node/);
  assert.match(await page.locator(".knowledge-card").first().textContent(), /Quote verified · awaiting review/);

  await page.getByRole("button", { name: "Inspect evidence" }).first().click();
  assert.match(await page.locator("#inspector-content").textContent(), /AI assessments/);
  assert.match(await page.locator("#inspector-content").textContent(), /attributed review/i);
  assert.match(await page.locator("#inspector-content").textContent(), /The statement follows the quoted sentence/);
  assert.match(await page.locator("#inspector-content").textContent(), /independent subscription-CLI assessment/);
  assert.match(await page.locator("#inspector-content").textContent(), /\/receipts\/job\.neutral\/assessment/);
  assert.match(await page.locator("#inspector-content").textContent(), /evidence\.neutral/);
  await page.locator("details.topic-correction-section").evaluate((element) => { element.open = true; });
  await page.locator("#inspector-topic").selectOption("node.second");
  await page.locator("#inspector-topic-note").fill("The second topic is a closer editorial fit.");
  await page.getByRole("button", { name: "Correct topic" }).click();
  assert.deepEqual(calls.find((call) => call.path.endsWith("/assign")).body, {
    node_id: "node.second",
    by: "Local editor",
    note: "The second topic is a closer editorial fit.",
  });
  assert.equal(proposition.id, "proposition.neutral");
  await page.waitForFunction(() => document.querySelector("#inspector-content")?.textContent.includes("Second neutral node"));

  await page.locator("details.revision-section > summary").click();
  await page.waitForSelector("#inspector-revision-statement:visible");
  const revisionStatement = page.locator("#inspector-revision-statement");
  const revisionQuote = page.locator("#inspector-revision-quote");
  assert.equal(await page.locator("#inspector-revision-type").inputValue(), "rule");
  assert.equal(await page.locator("#inspector-revision-detail").inputValue(), "");
  await revisionStatement.fill("The instrument records a result after verified calibration.");
  await revisionQuote.fill("This quote is not in the selected evidence.");
  await page.locator("#inspector-revision-note").fill("Clarifies the calibration requirement.");
  await page.getByRole("button", { name: "Propose correction" }).click();
  await page.waitForSelector("details.revision-section .form-error:not([hidden])");
  assert.match(await page.locator("details.revision-section .form-error").textContent(), /Exact quote does not match/);
  assert.equal(await revisionStatement.inputValue(), "The instrument records a result after verified calibration.");
  assert.equal(await revisionQuote.inputValue(), "This quote is not in the selected evidence.");

  await revisionQuote.fill(proposition.evidence[0].quote);
  await page.getByRole("button", { name: "Propose correction" }).click();
  await page.waitForFunction(() => document.querySelector("#inspector-content")?.textContent.includes("After · proposal"));
  const revisionCall = calls.filter((call) => call.path.endsWith("/revise")).at(-1);
  assert.deepEqual(revisionCall.body, {
    statement: "The instrument records a result after verified calibration.",
    detail: "",
    proposition_type: "rule",
    quote: "The instrument records a result after calibration.",
    evidence_id: "evidence.neutral",
    by: "Local editor",
    note: "Clarifies the calibration requirement.",
    relation_type: "refines",
    method: "human",
  });
  assert.equal(proposition.statement, "The instrument records a result after calibration.");
  assert.equal(workspace.propositions.at(-1).review.status, "pending");
  assert.match(await page.locator(".correction-history").textContent(), /Before · original/);
  assert.match(await page.locator(".correction-history").textContent(), /The instrument records a result after calibration/);
  assert.match(await page.locator(".correction-history").textContent(), /The instrument records a result after verified calibration/);
  await page.locator(".relationship-item .relationship-link").click();
  await page.waitForFunction(() => document.querySelector(".inspector-statement")?.textContent === "The instrument records a result after calibration.");

  await page.getByLabel("Review note", { exact: true }).fill("Quote and locator checked.");
  await page.getByLabel("Review method", { exact: true }).selectOption("agent");
  assert.equal(await page.locator("#inspector-proposition-review-note").inputValue(), "Quote and locator checked.");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#count-ready")?.textContent === "1");
  assert.deepEqual(calls.find((call) => call.path.endsWith("/review")).body, {
    status: "approved",
    by: "Local editor",
    note: "Quote and locator checked.",
    method: "agent",
  });

  await page.getByRole("button", { name: "Start" }).click();
  assert.equal(workspace.jobs[0].status, "running");

  const pathInput = page.getByLabel("Local path");
  await pathInput.fill("/missing/keep-me.txt");
  await page.getByRole("button", { name: "Import and prepare" }).click();
  await page.waitForSelector("#import-error:not([hidden])");
  assert.equal(await pathInput.inputValue(), "/missing/keep-me.txt");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(50);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `mobile layout overflowed by ${overflow}px`);
  const clippedCards = await page.locator(".knowledge-card").evaluateAll(cards => cards.filter(card => card.getBoundingClientRect().right > innerWidth).length);
  assert.equal(clippedCards, 0, "mobile cards and their inspect controls stay inside the visible panel");

  console.log("Workshop browser contract passed: nested assessment receipts, correction proposal/error retention, counterpart navigation, attributed review methods, job start, and 390px layout.");
} finally {
  await browser.close();
}
