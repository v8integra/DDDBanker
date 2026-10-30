# Accessibility checklist

The Bank of Bramblewood has two ways in: the **3D bank** (`/`) and the
**classic view** (`/classic.html`). Both use the same API, the same station
menus and the same windows, so nothing is 3D-only. This page lists what is
built, how it's tested, and what still needs a person to check.

Target: WCAG 2.1 AA for everything outside the 3D canvas.

## Two ways to bank

- [x] **Classic view** at `/classic.html`: a normal scrolling page with headings, an accounts table and one button per station. Every station's functions run in it (check in, sign up, teller, transfers, cards, savings and CDs, all three loan desks, insurance, security, help desk, notices, check out). No WebGL, pointer lock or 3D movement needed.
- [x] The first Tab stop on the 3D page is a skip link to the classic view. There's also a "Classic view" link in the HUD and in the pause menu.
- [x] The classic view links back to the 3D bank.
- [x] Settings are shared (same storage key), so text size, contrast and colors carry over between the two views.

## Getting around the 3D bank

- [x] **Quick travel** (T, the 📍 HUD button, or the pause menu): jump straight to the street, the ATM, the lobby or any station, and start talking. Hall stations while checked out offer to take you to Check-In instead.
- [x] Keyboard (WASD or arrows), mouse, click-to-move, touch joystick, and gamepad all work. Every interactable can be reached and used without a mouse.
- [x] **Remappable keys** in Settings → Controls. Each action keeps up to two keys. A key moved to one action is taken off any other. Escape always opens the pause menu and can't be rebound, and Tab, Alt, Ctrl, Meta and F5/F11/F12 can't be bound at all. "Reset keys" restores the defaults.
- [x] Fixed camera option, adjustable look sensitivity, invert Y.
- [x] The canvas has an `aria-label` that says how to move and how to open the menu.

## Seeing and reading

- [x] Text size 100 / 112.5 / 125 / 150%, applied to every menu and window.
- [x] Readable-font toggle (Atkinson Hyperlegible everywhere, replacing the pixel font).
- [x] **High contrast** menus. Defaults from `prefers-contrast: more`.
- [x] **Colorblind palette** (Settings → Status colors): Okabe–Ito blue/orange for money in and out, errors, and the security gate lights. Status never relies on color alone: money uses a minus sign and a spoken "plus" or "minus", and the gate uses an icon plus text.
- [x] **Reduced motion**: typewriter text appears at once, fades and door swings are instant, and the cursor blink stops. Defaults from `prefers-reduced-motion`. The classic view always shows text at once.
- [x] Focus is always visible (a thick outline on every control).
- [x] Touch targets are at least 44 px.

## Sound

- [x] Soft synthesized sounds for menus (move, pick, back, error, done, new notice) and the world (doors, the gate chime and lock).
- [x] **No sound-only information:** every sound goes with something on screen and, where it matters, a live announcement, so there's nothing to caption.
- [x] Settings → Sound: mute, overall volume, and separate menu and world volumes. The sliders play a sample when you let go.
- [x] Nothing plays until you click or press a key, and nothing loops or plays in the background.

## Screen readers

- [x] Menus and windows are native `<dialog>` elements opened with `showModal()`, so focus stays inside and the background is inert. Each is labelled by its title.
- [x] NPC dialogue: the full line is in a visually hidden copy and set as the dialog's `aria-describedby`, so it's read once on open instead of letter by letter. The typed copy is `aria-hidden`.
- [x] Focus moves to the first option when a window opens and goes back to what opened it when it closes. In the classic view, it goes back to the station you used, even after the page refreshes its buttons.
- [x] The blinking ▶ cursor uses empty alt text (`content: '▶' / ''`), so it isn't read as part of the option's name.
- [x] **Live announcements** (polite): the interact prompt ("Talk to Rowan, Teller"), location changes, toasts (gate locked, checked in, checked out), session expiry, and key remapping results. The classic view announces check-in, check-out, expiry, and "check in first" on locked stations.
- [x] Locked hall stations in the classic view use `aria-disabled` (not `disabled`), so they stay focusable and explain why.
- [x] Forms: every field has a label, hints and errors are tied with `aria-describedby`, errors are announced, and passwords have a show/hide toggle.
- [x] Tables: real `<table>` markup with header cells and captions, and money cells have spoken labels that say "plus" or "minus" instead of relying on color.
- [x] The session timeout warning is a modal dialog with a countdown and a "Stay checked in" button.

## Automated checks

`npm run test:e2e` runs Playwright on its own database and ports (API 3101, web 5273), so it can run alongside `npm run dev`. axe-core checks the WCAG 2.0/2.1 A and AA rules on:

- the classic view, checked out and checked in;
- a station dialogue, a table window, and display settings with high contrast and colorblind colors on;
- the 3D page's HUD, pause menu, Settings and quick travel.

Every spec also fails on any console error or CSP violation. `npm run test:e2e:prod` runs the same specs against the production build.

The specs also check that locked stations wait for check-in, that dialogs have the right name, description and focus, that focus comes back after closing, and that a remapped key is saved.

Unit tests cover key binding rules (`engine/bindings.test.ts`) and settings validation (`settings/settings.test.ts`).

## Still needs a person

- [ ] **Manual NVDA pass** (Windows, Firefox and Chrome). Not done yet: automated tools can't judge whether it actually sounds right. Walk through:
  1. Classic view: check in, check balances and recent activity, make a transfer, check out.
  2. 3D view: Tab to the skip link, then go back. Open the pause menu, Settings, and rebind a key. Use quick travel to reach the Teller.
  3. Let a session time out and confirm the warning and the expiry message are read.
- [ ] VoiceOver pass on macOS and iOS (Safari).
- [ ] Windows High Contrast / forced colors mode check.
- [ ] Zoom to 200% and 400% (reflow) on the classic view.

## Known limits

- The 3D canvas itself can't be read by a screen reader beyond its label. Use the classic view, or quick travel plus the announced prompts.
- Gamepad buttons aren't remappable yet (keyboard only).
