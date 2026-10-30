import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The 3D page: axe covers the HTML around the canvas (HUD, menus, windows).
// The canvas itself is described by its aria-label; the classic view is the
// full non-3D alternative.

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

async function openWorld(page: Page) {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/loading--done/, { timeout: 45_000 });
  await page.locator('#game').focus();
}

test.describe('3D view', () => {
  test('HUD and skip link pass axe', async ({ page }) => {
    await openWorld(page);
    await expect(page.getByRole('link', { name: /classic view/i }).first()).toHaveAttribute(
      'href',
      '/classic.html',
    );
    await expectNoAxeViolations(page);
  });

  test('pause menu and settings pass axe, and keys can be remapped', async ({ page }) => {
    await openWorld(page);
    await page.keyboard.press('Escape');
    const pause = page.locator('dialog[open]').last();
    await expect(pause.getByRole('button', { name: 'Quick travel' })).toBeVisible();
    await expectNoAxeViolations(page);

    await pause.getByRole('button', { name: 'Settings' }).click();
    const settings = page.locator('#settings-dialog');
    await expect(settings).toBeVisible();
    await expectNoAxeViolations(page);

    await settings.getByRole('button', { name: 'Change key for Quick travel' }).click();
    await page.keyboard.press('KeyG');
    await expect(settings.getByText('Quick travel is now G.')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('bramblewood.settings.v1'));
    expect(JSON.parse(stored ?? '{}').keyBindings.travel).toEqual(['KeyG']);
  });

  test('quick travel lists every place', async ({ page }) => {
    await openWorld(page);
    await page.keyboard.press('KeyT');
    const travel = page.locator('dialog[open]').last();
    await expect(travel).toContainText('Check-In');
    await expect(travel).toContainText('Teller');
    await expectNoAxeViolations(page);
  });
});
