import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  permissions: ['geolocation'],
  geolocation: { latitude: -18.8792, longitude: 47.5079 },
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });

// Wait for initial geolocation-driven marker placement to fill the fields
const latInput = page.locator('input[placeholder*="Latitude"]');
await latInput.waitFor({ state: 'visible', timeout: 15000 });
await page.waitForFunction(() => {
  const el = document.querySelector('input[placeholder*="Latitude"]');
  return el && el.value && el.value !== '';
}, { timeout: 15000 });

const initialLat = await latInput.inputValue();
const initialLng = await page.locator('input[placeholder*="Longitude"]').inputValue();
console.log('INITIAL_LAT:', initialLat, 'INITIAL_LNG:', initialLng);

await page.screenshot({ path: 'scratch_cursor_initial.png' });

// Click on the map at a different point to move the cursor marker
const mapBox = await page.locator('.gm-style').first().boundingBox();
const clickX = mapBox.x + mapBox.width * 0.3;
const clickY = mapBox.y + mapBox.height * 0.6;
await page.mouse.click(clickX, clickY);

await page.waitForTimeout(1500);

const afterClickLat = await latInput.inputValue();
const afterClickLng = await page.locator('input[placeholder*="Longitude"]').inputValue();
console.log('AFTER_CLICK_LAT:', afterClickLat, 'AFTER_CLICK_LNG:', afterClickLng);

await page.screenshot({ path: 'scratch_cursor_after_click.png' });

// Now try to drag the marker itself
const markerImg = page.locator('img[src*="markers"], area, img.gm-style, div[title*="Glissez"]').first();
let dragResult = 'not-attempted';
try {
  const marker = page.locator('[title*="Glissez"]').first();
  const box = await marker.boundingBox({ timeout: 5000 });
  if (box) {
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    dragResult = 'attempted';
  }
} catch (e) {
  dragResult = 'error: ' + e.message;
}

const afterDragLat = await latInput.inputValue();
const afterDragLng = await page.locator('input[placeholder*="Longitude"]').inputValue();
console.log('DRAG_RESULT:', dragResult);
console.log('AFTER_DRAG_LAT:', afterDragLat, 'AFTER_DRAG_LNG:', afterDragLng);

await page.screenshot({ path: 'scratch_cursor_after_drag.png' });

console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors));

await browser.close();
