import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  ledgerDue,
  ledgerExport,
  ledgerLookup,
  ledgerMastery,
  UnknownPackError,
} from './lib/tools.mjs';

const ledgerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(ledgerDir, '..');
const packsDir = process.env.LEDGER_PACKS_DIR ?? path.join(repoRoot, 'packs');
const stateDir = process.env.LEDGER_STATE_DIR ?? path.join(repoRoot, 'state');

const server = new McpServer({ name: 'fablewood-ledger', version: '1.0.0' });

function callContext() {
  return { packsDir, stateDir, now: Date.now() };
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { ...textResult(message), isError: true };
}

server.registerTool(
  'ledger_lookup',
  {
    description: 'Find learned facts by case-insensitive text or tag substring.',
    inputSchema: {
      query: z.string().describe('Non-empty substring to find.'),
      pack: z.string().optional().describe('Optional pack id.'),
    },
  },
  async (args) => {
    try {
      return jsonResult(await ledgerLookup(callContext(), args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'ledger_mastery',
  {
    description: 'Summarize derived mastery for a pack or tagged topic.',
    inputSchema: {
      pack: z.string().optional().describe('Optional pack id.'),
      topic: z.string().optional().describe('Optional tag substring.'),
    },
  },
  async (args) => {
    try {
      return jsonResult(await ledgerMastery(callContext(), args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'ledger_due',
  {
    description: 'List seen facts that are due for review, most stale first.',
    inputSchema: {
      pack: z.string().optional().describe('Optional pack id.'),
    },
  },
  async (args) => {
    try {
      return jsonResult(await ledgerDue(callContext(), args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'ledger_export',
  {
    description: 'Export facts at or above a mastery box as tagged Markdown.',
    inputSchema: {
      pack: z.string().describe('Required pack id.'),
      minBox: z.number().optional().describe('Minimum derived box; defaults to 3.'),
    },
  },
  async (args) => {
    try {
      const result = await ledgerExport(callContext(), args);
      return textResult(result.markdown);
    } catch (error) {
      if (error instanceof UnknownPackError) return errorResult(error);
      return errorResult(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
