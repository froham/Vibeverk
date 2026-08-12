const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const fileUrl = 'file://' + path.resolve(__dirname, 'repro.html');
  const widths = [375, 390, 768, 1024];
  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto(fileUrl);
    for (const id of ['variant-a', 'variant-b', 'variant-c']) {
      const legend = await page.$(`#${id} legend`);
      const box = await legend.boundingBox();
      const lineCount = await legend.evaluate(el => {
        // approximate line count via getClientRects on the legend itself
        return el.getClientRects().length;
      });
      const pillsRects = await page.$$eval(`#${id} .kd-pill`, els => els.map(e => e.getBoundingClientRect()));
      console.log(`w=${w} ${id}: legend box=`, JSON.stringify(box), `clientRects=${lineCount}`, `pills=${JSON.stringify(pillsRects.map(r=>({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)})))}`);
    }
    await page.screenshot({ path: path.resolve(__dirname, `shot-${w}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
})();
