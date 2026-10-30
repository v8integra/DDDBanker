import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, test } from './fixtures';

// The 3D page: axe covers the HTML around the canvas (HUD, menus, windows).
// The canvas itself is described by its aria-label; the classic view is the
// full non-3D alternative.

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

  test('evening lighting and sounds follow Settings', async ({ page }) => {
    // Count notes played instead of making real noise.
    await page.addInitScript(() => {
      const w = window as unknown as { notes: number; AudioContext: unknown };
      w.notes = 0;
      const Real = window.AudioContext;
      w.AudioContext = class extends Real {
        override createOscillator() {
          w.notes++;
          return super.createOscillator();
        }
      };
    });
    await page.goto('/?debug');
    await expect(page.locator('#loading')).toHaveClass(/loading--done/, { timeout: 45_000 });
    await page.locator('#game').focus();
    const notes = () => page.evaluate(() => (window as unknown as { notes: number }).notes);

    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expect.poll(notes).toBeGreaterThan(0);

    await page.locator('dialog[open]').last().getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Time of day').selectOption('evening');
    const street = () =>
      page.evaluate(() => {
        type Scene = {
          background: { getHexString(): string };
          getObjectByName(n: string): { children: unknown[] };
        };
        const g = (
          window as unknown as { __game: { game: { exterior: { level: { scene: Scene } } } } }
        ).__game;
        const scene = g.game.exterior.level.scene;
        return {
          sky: scene.background.getHexString(),
          lamps: scene.getObjectByName('street-lamps')!.children.length,
        };
      });
    await expect.poll(street).toEqual({ sky: '47507f', lamps: 7 });
    await page.getByLabel('Graphics quality').selectOption('low');
    await expect.poll(street).toEqual({ sky: '47507f', lamps: 0 });

    await page.getByLabel('Mute all sounds').check();
    await expect(page.getByLabel('Overall volume')).toBeDisabled();
    const before = await notes();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    expect(await notes()).toBe(before);
  });
});
