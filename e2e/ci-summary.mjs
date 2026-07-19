// Renders the Playwright json report (test-results/results.json) as a GitHub
// step summary. Run with `if: always()` so a red suite still gets a readable
// table; degrades to a note when the report is missing (an earlier step died).
import { readFileSync, appendFileSync } from 'node:fs';

const out = process.env.GITHUB_STEP_SUMMARY;
const write = (md) => (out ? appendFileSync(out, md + '\n') : console.log(md));

let report;
try {
  report = JSON.parse(readFileSync('test-results/results.json', 'utf8'));
} catch {
  write('## E2E\n\nNo `test-results/results.json` — the suite did not produce a report (see failed steps above).');
  process.exit(0);
}

const s = report.stats ?? {};
const failures = [];
const walk = (suite, trail) => {
  for (const child of suite.suites ?? []) walk(child, [...trail, child.title]);
  for (const spec of suite.specs ?? []) {
    if (!spec.ok) failures.push([...trail, spec.title].filter(Boolean).join(' › '));
  }
};
for (const suite of report.suites ?? []) walk(suite, [suite.title]);

const total = (s.expected ?? 0) + (s.unexpected ?? 0) + (s.skipped ?? 0) + (s.flaky ?? 0);
const icon = s.unexpected ? '❌' : '✅';
write(`## E2E ${icon}`);
write('');
write('| passed | failed | flaky | skipped | duration |');
write('|-------:|-------:|------:|--------:|---------:|');
write(
  `| ${s.expected ?? 0}/${total} | ${s.unexpected ?? 0} | ${s.flaky ?? 0} | ${s.skipped ?? 0} | ${((s.duration ?? 0) / 1000).toFixed(1)}s |`,
);
if (failures.length) {
  write('');
  write('**Failed:**');
  for (const f of failures) write(`- ${f}`);
  write('');
  write('_Traces + screenshots are in the `playwright-failure-*` artifact._');
}
