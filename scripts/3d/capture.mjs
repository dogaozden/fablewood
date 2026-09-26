import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { screenshot as capturePage } from './screenshot.mjs';

const screenshot = process.argv[2] ?? '.dream-loop/candidate.png';
const report = { screenshot, errors: [], warnings: [], samples: [] };
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') report.errors.push(message.text());
  if (message.type() === 'warning') report.warnings.push(message.text());
});
page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
page.on('requestfailed', request => report.errors.push(`${request.failure()?.errorText} ${request.url()}`));
try {
  await page.goto(`${process.env.FABLEWOOD_PREVIEW_URL ?? 'http://127.0.0.1:5411'}/?cinematic=1${process.argv.includes('--profile-render')||process.argv.includes('--motion-profile')?'&profile-render=1':''}`);
  await page.waitForFunction(() => window.__FABLEWOOD_READY, null, { timeout: 15000 });
  if (process.argv.includes('--party')) {
    await page.getByRole('button', { name: 'Exit photo mode' }).click();
    await page.getByRole('button', { name: /Wayfinder.*Places & paths/ }).click();
    await page.locator('.map-locations button').filter({ hasText: 'Mira' }).click();
    await page.waitForFunction(() => Math.hypot(window.__FW3D.state.position.x - 3, window.__FW3D.state.position.z - 6) < 2.5, null, { timeout: 25000 });
    await page.getByRole('button', { name: 'Mira', exact: true }).click();
    await page.getByRole('button', { name: 'Ask Mira to join you' }).click();
    await page.waitForFunction(() => window.__FW3D.state.companion === true);
    // Walk the recruited party into the well's foreground through normal input.
    for (const key of ['s','s','s','s','s','s','s','s','d','d','d','d','d','w','w']) {
      const before = await page.evaluate(() => window.__FW3D.state.position);
      await page.keyboard.press(key);
      await page.waitForFunction(p => Math.hypot(window.__FW3D.state.position.x-p.x,window.__FW3D.state.position.z-p.z)>.5, before);
    }
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await page.getByRole('button', { name: 'Enter photo mode' }).click();
  }
  await page.waitForTimeout(3000);
  const metricsSession = await page.context().newCDPSession(page);
  await metricsSession.send('Performance.enable');
  const metricsBefore = await metricsSession.send('Performance.getMetrics');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1100);
    report.samples.push(await page.evaluate(() => window.__FW3D?.stats));
  }
  const metricsAfter = await metricsSession.send('Performance.getMetrics');
  const metricMap = value => Object.fromEntries(value.metrics.map(item => [item.name, item.value]));
  report.performance = { before: metricMap(metricsBefore), after: metricMap(metricsAfter) };
  await metricsSession.detach();
  report.game = await page.evaluate(() => window.__FW3D);
  await writeFile(screenshot.replace(/\.png$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  if(process.argv.includes('--profile-render')) {
    report.renderer = await page.evaluate(() => {
      const realm=window.__FW_RENDERER, gl=realm.renderer.getContext();
      const extension=gl.getExtension('WEBGL_debug_renderer_info');
      const objects={meshes:0,casters:0,receivers:0,triangles:0,lights:0};
      realm.scene.traverseVisible(object=>{
        if(object.isLight)objects.lights++;
        if(!object.isMesh)return;
        objects.meshes++;
        objects.casters+=Number(object.castShadow);objects.receivers+=Number(object.receiveShadow);
        objects.triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);
      });
      return {vendor:extension?gl.getParameter(extension.UNMASKED_VENDOR_WEBGL):null,device:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,objects,draw:realm.renderer.info.render};
    });
    report.renderPassProbes = [];
    const configure = async (ao, shadows) => page.evaluate(({ao, shadows}) => {
      const realm = window.__FW_RENDERER;
      if(!realm)throw new Error('Development renderer profiler unavailable');
      realm.ambientOcclusion.enabled = ao;
      realm.renderer.shadowMap.enabled = shadows;
      realm.scene.traverse(object => {
        if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])material.needsUpdate=true;
      });
    },{ao,shadows});
    try {
      for(const [name,ao,shadows] of [['no-ao',false,true],['no-shadows',true,false],['neither',false,false]]) {
        await configure(ao,shadows);
        await page.waitForTimeout(2500);
        const samples=[];
        for(let i=0;i<3;i++){await page.waitForTimeout(1100);samples.push(await page.evaluate(()=>window.__FW3D.stats));}
        report.renderPassProbes.push({name,samples});
      }
    } finally {
      await configure(true,true);
      await page.waitForTimeout(2500);
    }
  }
  await capturePage(page, screenshot);
  report.captured = true;
  if (process.argv.includes('--motion-profile')) {
    const sampleFrames = () => page.evaluate(() => new Promise(resolve => {
      const deltas = [];
      let start, last;
      const sample = now => {
        start ??= now;
        if (last !== undefined) deltas.push(now - last);
        last = now;
        if (now - start < 3000) requestAnimationFrame(sample);
        else {
          const sorted = [...deltas].sort((a, b) => a - b);
          resolve({ frames: deltas.length, meanMs: deltas.reduce((a, b) => a + b, 0) / deltas.length,
            p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1),
            framesOver34Ms: deltas.filter(delta => delta > 34).length });
        }
      };
      requestAnimationFrame(sample);
    }));
    const idle = await sampleFrames();
    const orbit = async direction => {
      const programsBefore = await page.evaluate(() => window.__FW_RENDERER?.renderer.info.programs?.length);
      const orbitSample = sampleFrames();
      await page.mouse.move(direction > 0 ? 900 : 1220, 500);
      await page.mouse.down({ button: 'right' });
      try {
        for (let i = 1; i <= 40; i++) {
          await page.mouse.move((direction > 0 ? 900 : 1220) + direction * i * 8, 500 + Math.sin(i / 40 * Math.PI) * 30);
          await page.waitForTimeout(50);
        }
      } finally {
        await page.mouse.up({ button: 'right' });
      }
      return { ...await orbitSample, programsBefore,
        programsAfter: await page.evaluate(() => window.__FW_RENDERER?.renderer.info.programs?.length) };
    };
    report.motion = { idle, orbit: await orbit(1), returnOrbit: await orbit(-1) };
  }
} catch (error) {
  report.failure = String(error);
  report.game = await page.evaluate(() => window.__FW3D).catch(() => null);
  report.body = await page.locator('body').innerText().catch(() => 'Page unavailable');
  process.exitCode = 1;
} finally {
  await writeFile(screenshot.replace(/\.png$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await browser.close();
}
