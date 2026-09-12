import { test, expect, Page, Locator } from '@playwright/test';

/**
 * E2E coverage for /test/interaction.html — three trees exercising the rc03
 * three-level selection model (focusedNode / highlightedPaths / selectedPaths),
 * checkbox cascade, and click-behavior modes.
 *
 * Sample data is sorted alphabetically by `name` (sortByName). Useful paths:
 *   '1'   Documents     (level 1, root)
 *   '1.1' Work          (level 2)
 *   '1.2' Personal      (level 2)
 *   '2'   Downloads     (level 1)
 *   '2.1' Software      (level 2)
 *   '3'   Projects      (level 1)
 *   '3.1' Web App       (level 2)
 *
 * Click Behavior tree uses expandLevel=2 (levels 1 & 2 visible). Multi-Select
 * tree uses expandLevel=3 (everything visible).
 *
 * Note on checkbox DOM: web-treeview renders a <label class="wtv__checkbox">
 * wrapping a hidden native <input> (+ .wtv__checkbox-box). `checkboxOf()` is the
 * visible/clickable label; `checkboxInputOf()` is the inner input (:checked state).
 */

const PAGE = '/test/interaction.html';

// ── Helpers ─────────────────────────────────────────────────────────────────

function cardByHeading(page: Page, heading: string): Locator {
  return page.locator('.card').filter({ has: page.locator('h2', { hasText: heading }) }).first();
}

function clickBehaviorCard(page: Page): Locator {
  return cardByHeading(page, 'Click Behavior');
}

function multiSelectCard(page: Page): Locator {
  return cardByHeading(page, 'Multi-Select');
}

function keyboardNavCard(page: Page): Locator {
  return cardByHeading(page, 'Keyboard Navigation');
}

function nodeInCard(card: Locator, path: string): Locator {
  return card.locator(`.wtv__node[data-tree-path="${path}"]`).first();
}

function nodeContent(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__node-content').first();
}

function checkboxOf(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__checkbox').first();
}

function checkboxInputOf(node: Locator): Locator {
  return node.locator('> .wtv__node-row .wtv__checkbox input').first();
}

function outputValue(card: Locator, label: string): Locator {
  return card
    .locator('.output')
    .filter({ has: card.page().locator('p.output-label', { hasText: label }) })
    .first()
    .locator('pre')
    .first();
}

async function gotoInteraction(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator('.wtv__node').first()).toBeVisible();
}

// ── Click Behavior tree ─────────────────────────────────────────────────────

test.describe('Click Behavior tree', () => {
  test('default mode (expand-and-focus): clicking a node sets focusedNode', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await expect(outputValue(card, 'Focused Node')).toHaveText('(none)');

    await nodeContent(nodeInCard(card, '1')).click();

    await expect(outputValue(card, 'Focused Node')).toContainText('Documents');
    await expect(outputValue(card, 'Focused Node')).toContainText('(1)');
  });

  test('Ctrl+click adds paths to highlightedPaths', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await expect(outputValue(card, 'Highlighted')).toContainText('(none');

    await nodeContent(nodeInCard(card, '1')).click();
    await nodeContent(nodeInCard(card, '2')).click({ modifiers: ['Control'] });
    await nodeContent(nodeInCard(card, '3')).click({ modifiers: ['Control'] });

    const highlighted = outputValue(card, 'Highlighted');
    await expect(highlighted).toContainText('1');
    await expect(highlighted).toContainText('2');
    await expect(highlighted).toContainText('3');
  });

  test('Clear All resets highlighted / selected outputs', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await nodeContent(nodeInCard(card, '1')).click();
    await nodeContent(nodeInCard(card, '2')).click({ modifiers: ['Control'] });
    await expect(outputValue(card, 'Highlighted')).not.toContainText('(none');

    await card.getByRole('button', { name: 'Clear All' }).click();
    await expect(outputValue(card, 'Highlighted')).toContainText('(none');
    await expect(outputValue(card, 'Selected / Checked')).toContainText('(none');
  });

  test('toggling Show Checkboxes renders checkboxes on selectable nodes', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await expect(checkboxOf(nodeInCard(card, '1'))).toHaveCount(0);

    await card.getByText('Show Checkboxes').click();

    await expect(checkboxOf(nodeInCard(card, '1'))).toBeVisible();
    await expect(checkboxOf(nodeInCard(card, '2'))).toBeVisible();
  });

  test('cascade mode: toggling a parent checkbox checks visible descendants', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByText('Show Checkboxes').click();
    await card.getByLabel('Checkbox Mode:').selectOption('cascade');

    await checkboxOf(nodeInCard(card, '1')).click();

    // Emitted set uses the default cascadeSelectPolicy='rolled-up' (rc09): a
    // fully-checked subtree collapses to its root, so only '1' is emitted — the
    // descendants are covered by it, not listed.
    const selected = outputValue(card, 'Selected / Checked');
    await expect(selected).toContainText('1');
    await expect(selected).not.toContainText('1.1');
    await expect(selected).not.toContainText('1.2');

    // The checkbox VISUAL state is still the full canonical set: every descendant
    // is checked on screen even though the emitted projection rolls up to the root.
    await expect(checkboxInputOf(nodeInCard(card, '1'))).toBeChecked();
    await expect(checkboxInputOf(nodeInCard(card, '1.1'))).toBeChecked();
    await expect(checkboxInputOf(nodeInCard(card, '1.2'))).toBeChecked();
  });

  test('independent mode: checking children does NOT auto-check parent', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByText('Show Checkboxes').click();
    // Mode stays 'independent' (default).

    await checkboxOf(nodeInCard(card, '1.1')).click();
    await checkboxOf(nodeInCard(card, '1.2')).click();

    await expect(checkboxInputOf(nodeInCard(card, '1.1'))).toBeChecked();
    await expect(checkboxInputOf(nodeInCard(card, '1.2'))).toBeChecked();

    await expect(checkboxInputOf(nodeInCard(card, '1'))).not.toBeChecked();

    const selected = outputValue(card, 'Selected / Checked');
    await expect(selected).toContainText('1.1');
    await expect(selected).toContainText('1.2');
    await expect(selected).not.toHaveText(/(^|, )1(,|$)/);
  });

  test('shouldClickToggleCheckbox: plain click toggles checkbox and skips focus/highlight', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByText('Show Checkboxes').click();
    await card.getByText('Click row toggles checkbox').click();

    await nodeContent(nodeInCard(card, '1.1')).click();

    await expect(checkboxInputOf(nodeInCard(card, '1.1'))).toBeChecked();
    await expect(outputValue(card, 'Selected / Checked')).toContainText('1.1');

    await expect(outputValue(card, 'Focused Node')).toHaveText('(none)');
    await expect(outputValue(card, 'Highlighted')).toHaveText('(none)');

    // Gap > 400ms so the re-click reads as a distinct single click rather than
    // a double-click (which the controller now consumes as a single gesture).
    await page.waitForTimeout(450);
    await nodeContent(nodeInCard(card, '1.1')).click();
    await expect(checkboxInputOf(nodeInCard(card, '1.1'))).not.toBeChecked();
  });

  test('shouldClickToggleCheckbox: Ctrl+click still builds multi-highlight (modifier falls through)', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByText('Show Checkboxes').click();
    await card.getByText('Click row toggles checkbox').click();

    await nodeContent(nodeInCard(card, '1.1')).click({ modifiers: ['Control'] });
    await nodeContent(nodeInCard(card, '1.2')).click({ modifiers: ['Control'] });

    await expect(outputValue(card, 'Highlighted')).toContainText('1.1');
    await expect(outputValue(card, 'Highlighted')).toContainText('1.2');

    await expect(checkboxInputOf(nodeInCard(card, '1.1'))).not.toBeChecked();
    await expect(checkboxInputOf(nodeInCard(card, '1.2'))).not.toBeChecked();
  });

  test('expand mode: clicking does NOT update focusedNode', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByLabel('Click Behavior:').selectOption('expand');

    await nodeContent(nodeInCard(card, '1')).click();

    await expect(outputValue(card, 'Focused Node')).toHaveText('(none)');
  });

  test('select mode: single click focuses without toggling expand state', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByLabel('Click Behavior:').selectOption('select');

    const docs = nodeInCard(card, '1');
    await nodeContent(docs).click();

    await expect(outputValue(card, 'Focused Node')).toContainText('Documents');
    await expect(nodeInCard(card, '1.1')).toBeVisible();
  });

  test('expand-and-focus mode: clicking a node toggles its expand state', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    const docs = nodeInCard(card, '1');
    await expect(nodeInCard(card, '1.1')).toBeVisible();

    await nodeContent(docs).click();
    await expect(nodeInCard(card, '1.1')).toBeHidden();

    // Gap > 400ms so the re-click reads as a distinct single click, not a
    // double-click (which the controller consumes as a single open gesture).
    await page.waitForTimeout(450);
    await nodeContent(docs).click();
    await expect(nodeInCard(card, '1.1')).toBeVisible();
  });

  test('expand mode: clicking a node toggles its expand state', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByLabel('Click Behavior:').selectOption('expand');

    const docs = nodeInCard(card, '1');
    await expect(nodeInCard(card, '1.1')).toBeVisible();

    await nodeContent(docs).click();
    await expect(nodeInCard(card, '1.1')).toBeHidden();

    // Gap > 400ms so the re-click reads as a distinct single click, not a
    // double-click (which the controller consumes as a single open gesture).
    await page.waitForTimeout(450);
    await nodeContent(docs).click();
    await expect(nodeInCard(card, '1.1')).toBeVisible();
  });

  test('select mode: double-click toggles expand state', async ({ page }) => {
    await gotoInteraction(page);
    const card = clickBehaviorCard(page);

    await card.getByLabel('Click Behavior:').selectOption('select');

    const docs = nodeInCard(card, '1');
    await expect(nodeInCard(card, '1.1')).toBeVisible();

    await nodeContent(docs).dblclick();
    await expect(nodeInCard(card, '1.1')).toBeHidden();

    await nodeContent(docs).dblclick();
    await expect(nodeInCard(card, '1.1')).toBeVisible();
  });
});

// ── Multi-Select tree ───────────────────────────────────────────────────────

test.describe('Multi-Select tree', () => {
  test('Ctrl+click on two nodes highlights both', async ({ page }) => {
    await gotoInteraction(page);
    const card = multiSelectCard(page);

    await nodeContent(nodeInCard(card, '1')).click();
    await nodeContent(nodeInCard(card, '3')).click({ modifiers: ['Control'] });

    const highlighted = outputValue(card, 'Highlighted');
    await expect(highlighted).toContainText('1');
    await expect(highlighted).toContainText('3');
  });

  test('Shift+click selects a visual range', async ({ page }) => {
    await gotoInteraction(page);
    const card = multiSelectCard(page);

    await nodeContent(nodeInCard(card, '1')).click();
    await nodeContent(nodeInCard(card, '3')).click({ modifiers: ['Shift'] });

    const highlighted = outputValue(card, 'Highlighted');
    await expect(highlighted).toContainText('1');
    await expect(highlighted).toContainText('3');
    await expect(highlighted).toContainText('2');
  });

  test('Clear All resets multi-select outputs', async ({ page }) => {
    await gotoInteraction(page);
    const card = multiSelectCard(page);

    await nodeContent(nodeInCard(card, '1')).click();
    await nodeContent(nodeInCard(card, '2')).click({ modifiers: ['Control'] });
    await expect(outputValue(card, 'Highlighted')).not.toContainText('(none');

    await card.getByRole('button', { name: 'Clear All' }).click();
    await expect(outputValue(card, 'Highlighted')).toContainText('(none');
  });
});

// ── Keyboard Navigation tree ────────────────────────────────────────────────

test.describe('Keyboard Navigation tree', () => {
  test('clicking a node populates Focused Node + appends to Navigation Log', async ({ page }) => {
    await gotoInteraction(page);
    const card = keyboardNavCard(page);

    await nodeContent(nodeInCard(card, '1')).click();
    await expect(outputValue(card, 'Focused Node')).toContainText('Documents');
    await expect(outputValue(card, 'Navigation Log')).toContainText('Documents');

    await nodeContent(nodeInCard(card, '2')).click();
    await expect(outputValue(card, 'Focused Node')).toContainText('Downloads');
    const log = outputValue(card, 'Navigation Log');
    await expect(log).toContainText('Downloads');
    // Earlier entry stays in the log.
    await expect(log).toContainText('Documents');
  });
});
