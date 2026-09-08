import { writeFile } from 'node:fs/promises';

/** Capture the browser compositor directly; this remains an actual page image. */
export async function screenshot(page, path, timeout = 15000) {
  const session = await page.context().newCDPSession(page);
  let timer;
  try {
    await page.evaluate(() => window.__FW3D?.pauseRender?.(true));
    const shot = await Promise.race([
      session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser screenshot timed out after ${timeout}ms.`)), timeout); }),
    ]);
    await writeFile(path, Buffer.from(shot.data, 'base64'));
  } finally {
    clearTimeout(timer);
    await page.evaluate(() => window.__FW3D?.pauseRender?.(false)).catch(() => {});
    await session.detach();
  }
}
