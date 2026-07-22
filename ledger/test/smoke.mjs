import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { loadPacks } from '../lib/packs.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ledgerDir = path.resolve(testDir, '..');
const repoRoot = path.resolve(ledgerDir, '..');
const serverPath = path.join(ledgerDir, 'server.mjs');
const packsDir = process.env.LEDGER_PACKS_DIR ?? path.join(repoRoot, 'packs');

const childEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: childEnv,
  stderr: 'pipe',
});
const client = new Client({ name: 'fablewood-ledger-smoke', version: '1.0.0' });

const stderrChunks = [];
transport.stderr?.on('data', (chunk) => stderrChunks.push(chunk));

try {
  await client.connect(transport);
  const listed = await client.listTools();
  console.log(JSON.stringify({
    operation: 'listTools',
    tools: listed.tools.map((tool) => tool.name),
  }, null, 2));

  const loaded = await loadPacks(packsDir);
  const pack = loaded.packs[0];
  if (!pack || !pack.facts[0]) {
    throw new Error(`smoke test needs at least one fact; warnings: ${loaded.warnings.join('; ')}`);
  }
  const query = pack.facts[0].statement.trim().split(/\s+/)[0];

  const calls = [
    ['ledger_lookup', { query, pack: pack.meta.id }],
    ['ledger_mastery', { pack: pack.meta.id }],
    ['ledger_due', { pack: pack.meta.id }],
    ['ledger_export', { pack: pack.meta.id }],
  ];

  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    console.log(JSON.stringify({ operation: name, result }, null, 2));
    if (result.isError) throw new Error(`${name} returned an MCP tool error`);
  }
} catch (error) {
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  if (stderr) console.error(stderr);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
