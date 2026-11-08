import { test, expect, type Page, WEBKIT_NO_NATIVE_DND, hasNoNativeDnd } from './fixtures';

/**
 * highlight-on-page-drag (same option as web-dropzone) + the empty drop zone
 * (/test/highlight-on-page-drag.html).
 *
 * Real mouse drags (Chromium starts a native HTML5 drag). A live browser drag
 * pulses `dragover` continuously even when the mouse rests, Playwright only on
 * moves — `hold()` jiggles the mouse so the page tracker's heartbeat stays alive.
 */

const PAGE = '/test/highlight-on-page-drag.html';

test.skip(hasNoNativeDnd, WEBKIT_NO_NATIVE_DND);

type Pt = { x: number; y: number };
let cur: Pt = { x: 0, y: 0 };

async function moveTo(page: Page, p: Pt, steps = 8) {
  cur = p;
  await page.mouse.move(p.x, p.y, { steps });
}
async function hold(page: Page, ms = 300) {
  for (let t = 0; t < ms; t += 60) {
    await page.mouse.move(cur.x + ((t / 60) % 2), cur.y);
    await page.waitForTimeout(60);
  }
}
const center = async (page: Page, sel: string): Promise<Pt> => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const zoneCenter = (page: Page, id: string): Promise<Pt | null> =>
  page.locator('#' + id).evaluate((el: any) => {
    const r = el.shadowRoot.querySelector('.wtv__empty-zone')?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
const zone = (page: Page, id: string) =>
  page.locator('#' + id).evaluate((el: any) => {
    const z = el.shadowRoot.querySelector('.wtv__empty-zone');
    return { armed: el.hasAttribute('armed'), isArmed: el.isArmed, state: el.matches(':state(armed)'), zone: !!z, active: !!z?.classList.contains('wtv__empty-zone--active') };
  });

async function startDrag(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('#source .wtv__node[data-tree-path="2"]')).toBeVisible();
  const leaf = await center(page, '#source .wtv__node[data-tree-path="2"] .wtv__node-content');
  await moveTo(page, leaf, 1);
  await page.mouse.down();
  await moveTo(page, { x: leaf.x + 40, y: leaf.y + 40 });
  await hold(page);
}

test('a node drag anywhere arms the opted-in empty tree: armed attr + :state(armed) + its drop zone', async ({ page }) => {
  await page.goto(PAGE);
  expect(await zone(page, 'armed')).toMatchObject({ armed: false, isArmed: false, zone: false });
  await startDrag(page);
  expect(await zone(page, 'armed')).toEqual({ armed: true, isArmed: true, state: true, zone: true, active: false });
  // not opted in → nothing; drag-drop-mode="none" → never armed
  expect(await zone(page, 'plain')).toMatchObject({ armed: false, zone: false });
  expect(await zone(page, 'locked')).toMatchObject({ armed: false, zone: false });
  await page.mouse.up();
});

test('over the zone it is engaged; back on the page it stays armed; the drop / release disarms', async ({ page }) => {
  await startDrag(page);
  await moveTo(page, (await zoneCenter(page, 'armed'))!, 10);
  await hold(page);
  expect(await zone(page, 'armed')).toMatchObject({ armed: true, zone: true, active: true });
  await moveTo(page, await center(page, '#gutter'));
  await hold(page);
  expect(await zone(page, 'armed')).toMatchObject({ armed: true, zone: true, active: false });
  await page.mouse.up();
  await expect.poll(async () => (await zone(page, 'armed')).armed).toBe(false);
  expect(await zone(page, 'armed')).toMatchObject({ isArmed: false, zone: false });
});

test('switching highlight-on-page-drag off mid-drag disarms at once', async ({ page }) => {
  await startDrag(page);
  expect((await zone(page, 'armed')).armed).toBe(true);
  await page.locator('#armed').evaluate((el: any) => { el.shouldHighlightOnPageDrag = false; });
  await expect.poll(async () => (await zone(page, 'armed')).armed).toBe(false);
  await page.mouse.up();
});

test('empty drop zone: leaving it downwards across a fractional edge, then sideways, drops the engaged look', async ({ page }) => {
  // The zone's bottom sits on a fractional pixel (min-height 80.6px); drag events carry whole
  // pixels, so the leave lands at y = floor(bottom) — "inside" by the rect. Then moving sideways
  // happens outside the zone (no further leave). The zone must still disengage.
  await startDrag(page);
  await moveTo(page, (await zoneCenter(page, 'placeholder'))!, 10);
  await hold(page);
  expect((await zone(page, 'placeholder')).active).toBe(true);
  const r = await page.locator('#placeholder').evaluate((el: any) => {
    const b = el.shadowRoot.querySelector('.wtv__empty-zone').getBoundingClientRect();
    return { left: b.left, bottom: b.bottom, cx: b.left + b.width / 2 };
  });
  await moveTo(page, { x: r.cx, y: r.bottom + 0.3 }, 4);
  await hold(page);
  await moveTo(page, { x: r.left - 40, y: r.bottom + 0.3 }, 6);
  await hold(page);
  expect((await zone(page, 'placeholder')).active).toBe(false);
  await page.mouse.up();
});
