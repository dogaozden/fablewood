import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { once } from 'node:events';

const [script, ...args] = process.argv.slice(2);
if (!['capture.mjs', 'playthrough.mjs'].includes(script)) throw new Error('Choose a checked-in 3D QA script.');
const stateDir = await mkdtemp('/private/tmp/fablewood-3d-preview-');
const port = 5418;
const env = { ...process.env, STATE_DIR: stateDir, JUDGE_MODE: 'stub', FABLEWOOD_PREVIEW_URL: `http://127.0.0.1:${port}` };
console.log(JSON.stringify({ isolatedState: stateDir, port }));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Preview did not become ready.')), 30000);
    server.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited before readiness (${code}).`)); });
    server.once('error', reject);
  });
  const child = spawn(process.execPath, [`scripts/3d/${script}`, ...args], { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
}
