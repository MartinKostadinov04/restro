# Design-skills trial: Vercel web interface guidelines and UI UX Pro Max on one admin and one guest screen

> Filed 2026-10-18 by the lead (session "UI/UX skills for workflows"). Made by: trial session (Sonnet). For: the UI/UX skills research, before D106. Source: the trial session's report and its notes folder `design-skills-trial/`. Status: see `docs/deliverables.md`.

## The trial session's report (verbatim summary, 2026-10-17)

**Recommendation:** use the Vercel skill as an admin-only review step; skip UI UX Pro Max.

- **Guidelines version:** repo `vercel-labs/web-interface-guidelines`, commit `434b7f9`, 2026-10-05. The skill itself (`agent-skills` `063bee9`, 2026-08-28) is only a pointer that fetches `command.md` from the unpinned `main` branch every run.
- **Code reviewed:** branch `ad/foundation` @ `38f5f6e`. One model pass applying the rules by hand; the classification is the reviewer's judgement.

| Screen | REAL | COVERED | NOISE |
|---|---|---|---|
| Admin Design tab (14 files) | 4 | 0 | 9 |
| Guest face editorial-market (22 files) | 6 | 9 | 7 |

- 6 of the 10 REAL findings are in the ordering and payment sheets, off in D79; only the four admin ones matter now (became T88).
- The face's 9 COVERED items are already required by the designer guide's §7.5 and `css.ts`.
- NOISE: mostly the Title Case and "&" copy rules, which contradict BG/EN sentence case.

**UI UX Pro Max:** its only point not already in `platform-reference.md` was "inline error tied to the field, not a red border only" (also found by Vercel). Contradictions: a landing-page pattern, Google Fonts, a hex palette, a GSAP scroll-reveal snippet even at motion 2/10, `next/image` for a framework-free face. The generator matched "hospitality" and produced a consumer-restaurant landing system. Scripts ran in under half a second each, standard library only, no network; `python -I` breaks them (`python -E -s -X utf8` works).

**Decided from it:** D106 (Vercel rules pinned with overrides; UI UX Pro Max rejected); the four admin defects became T88.

## Appendix A: the Vercel finding table

# Vercel web-design-guidelines review — finding table

- Guidelines reviewed: `vercel-labs/web-interface-guidelines` `command.md`, repo HEAD `434b7f9` (2026-10-05, "Add desktop overscroll guideline"); `command.md` last changed in `4ecfb9f` (2026-10-05). Fetched live 2026-10-17; saved as `vercel-guidelines-command.md` (191 lines).
- Skill folder: `vercel-labs/agent-skills` `skills/web-design-guidelines` (commit `063bee9`, 2026-08-28; SKILL.md v1.0.0). The skill is only a pointer: it tells the agent to fetch the guidelines and apply them. No script, no checker.
- Code reviewed: branch `ad/foundation` @ `38f5f6e` (exported to `review/`), because the worktree's own base (main @ 5ac39ed) has neither the Design tab nor editorial-market. Lines below refer to that commit.
- Method: I (the model) read every file and applied the rules by hand, as the skill intends. Face CSS lives in `css.ts` / `services/services-css.ts` (not tsx); I read it where a rule depends on it.
- Not reviewed: `*.test.tsx`, `services/test-kit.tsx`, `preview/`, the guest page in apps/web, the shadcn `components/ui/*` files.

Class: REAL = a defect our rules miss. COVERED = the rule already exists in visualization-shell.md section 7.5 (or elsewhere) and/or a test, and the code complies. NOISE = does not apply or false positive.

## A. Admin Design tab (apps/web/src/design/*.tsx, 14 files)

| # | file:line | Vercel rule | Class | Note |
|---|---|---|---|---|
| A1 | design-panel.tsx:129, :368 | Warn before navigation with unsaved changes | REAL | The tab tracks `dirty` and shows "unsaved", but nothing guards leaving (no `beforeunload`, no router guard; grep finds none in apps/web). Edits to colours/font/logo are lost on tab close or sidebar click. Not in platform-reference.md. |
| A2 | design-panel.tsx:329 | Sticky footers must not cover the focused element | REAL | Save bar is `sticky bottom-0 z-10`; no `scroll-padding-bottom` anywhere in apps/web, so tabbing down the form can leave the focused control under the bar. |
| A3 | design-skeleton.tsx:12 (ui/skeleton `animate-pulse`), design-preview.tsx:166 (`animate-spin`) | Honor prefers-reduced-motion | REAL (low) | No `prefers-reduced-motion`/`motion-reduce` in apps/web at all. Admin-wide shadcn default; 7.5 covers faces only. |
| A4 | colour-panel.tsx:105-113, :133-139, :98-104 | Async updates need aria-live="polite" | REAL (low) | Saturation warning and pale-highlight note appear while the person edits, with no live region (`role="note"`); the hint line toggles `role="alert"` on an element already in the DOM, which screen readers often skip. |
| A5 | header-name-field.tsx:97, :62-73 | Submit stays enabled until request starts; focus first error | NOISE | Disabled-until-dirty + `role="alert"` error with `aria-describedby` is a deliberate shadcn pattern. |
| A6 | hex-field.tsx:43-65, header-name-field.tsx:81 | Inputs need `name` / autocomplete | NOISE | Controlled inputs, no native form post; `autoComplete="off"` and `spellCheck={false}` are already set on the hex box. |
| A7 | logo-field.tsx:83, template-gallery.tsx:81 | `<img>` needs width and height | NOISE | Gallery image has `aspect-[4/3] w-full` (space reserved); logo is a small `max-h-12` admin thumbnail. |
| A8 | logo-field.tsx:78 | Form controls need label | NOISE | `<Label>` without `htmlFor`, but the file input has `aria-label` and the visible button opens it. |
| A9 | logo-field.tsx:115 | Destructive actions need confirmation/undo | NOISE | "Remove" only clears the form state; nothing is saved until "Save look". |
| A10 | colour-panel.tsx:51 | (hardcoded colours) | NOISE | Hex literals are picker fallbacks in an admin component; 7.5 "theme tokens only" is for faces. |
| A11 | segmented.tsx:39, role-panel.tsx:241 | Touch targets (not a Vercel rule) | NOISE | Small admin buttons; desktop tool. |
| A12 | role-panel.tsx:207 | tabular-nums for number columns | NOISE | Contrast ratios in chips, not columns. |
| A13 | look-options.tsx, template-gallery.tsx, header-name-field.tsx (all strings) | Title Case headings/buttons, "&" for "and", second person | NOISE | English-only copy style; admin is BG + EN in sentence case via next-intl. Applying it would contradict Bulgarian. |
| A14 | role-panel.tsx:49 | Locale: use Intl | pass | Already uses `Intl.NumberFormat` with the admin locale. |
| A15 | messages bg.json (`saving`, `loading`, `uploading`) | Loading states end with "…" | pass | All end with "…". |

Admin totals: REAL 4 (A1 to A4), COVERED 0, NOISE 9 (A5 to A13), passes 2.

## B. Guest face editorial-market (packages/faces/editorial-market/src/**/*.tsx, 22 files without tests)

| # | file:line | Vercel rule | Class | Note |
|---|---|---|---|---|
| B1 | services/dish-order.tsx:67,76 ; services-css.ts:374 ; bag.test.tsx:194 | Errors inline next to fields; focus first error; colour is not the only signal | REAL | When "Add to bag" is pressed with a required choice missing, the only change is the legend's small text turning `accentText` (class `is-invalid`). No message, no `aria-invalid`, no focus move. The test only asserts the class exists. 7.5 has no rule on validation feedback. (Ordering is off in D79, preview only.) |
| B2 | services/parts.tsx:51 ; pay-sheet.tsx:270,297 ; overlay.tsx:79 | Headings hierarchical | REAL (low) | Inside a service dialog the first heading is an `h3` (dialog title is a `<span>`), so there is no h2. 7.5 "Semantics" covers the menu page (h1/h2/h3/h4) but not dialogs. |
| B3 | services/pay-sheet.tsx:324-329 | Disable spellcheck on codes; autocomplete | REAL | Promo code input has no `spellCheck={false}`, `autoCapitalize`, `autoComplete="off"` or `name`. (Payment is off in D79.) |
| B4 | services/pay-sheet.tsx:311 | Hardcoded number formats | REAL (low) | `placeholder="0,00"` is fixed to a decimal comma in every language; also `aria-invalid` at :312 has no visible message. |
| B5 | services/bag-sheet.tsx:70-77 | Destructive actions need confirmation or undo | REAL (low) | "Remove" drops a line (with its options and note) at once, no undo. |
| B6 | services/bill-sheet.tsx:35,52 ; bag-sheet.tsx:81 ; receipt-page.tsx:100,108 | tabular-nums for number columns | REAL (low) | Amount columns in bag, bill and receipt; css has no `font-variant-numeric` anywhere. |
| B7 | category-rail.tsx:81 | Honor prefers-reduced-motion | COVERED | 7.5 reduced motion; code calls `prefersReducedMotion()`; css.ts:762-767, 892, 1056, 1085 have the media queries. |
| B8 | overlay.tsx:44-45 (no overscroll rule in tsx) | overscroll-behavior: contain in modals | COVERED | css.ts:478 sets it; overlay keeps page from scrolling. |
| B9 | header.tsx:57,71 ; item.tsx:81,135 ; many buttons (no focus classes in tsx) | Visible focus; no outline-none | COVERED | 7.5 Focus; css.ts:49-50 `:focus-visible`. |
| B10 | parts.tsx:88-95 | `<img>` width/height, lazy/priority | COVERED | 7.5 No layout shift; `imageAttributes` sets width/height; section.tsx:15 eager for first 3. |
| B11 | item.tsx:102 | Long text: truncate/line-clamp | COVERED | 7.5 "never truncate a name; descriptions only with a way to read the rest"; css.ts:321 clamp 3 + `data-clamped`. |
| B12 | services/parts.tsx:82-100 | Touch target size (not a Vercel rule; 44 px) | COVERED | 7.5 44x44; services-css.ts:150-205 `min-width/height: 44px`. |
| B13 | face.tsx:230 | Handle empty states | COVERED | `rm-empty` with `role="status"` and a clear-filters button (7.5 filters semantics). |
| B14 | overlay.tsx:67-91 | Dialog focus/keys | COVERED | 7.5 Focus (role=dialog, name, focus in, Tab trap, Esc, return focus). |
| B15 | face.tsx:184-192 etc. | lang on foreign text | COVERED | 7.5 Set lang; used on nearly every text node. |
| B16 | whole face | Skip link for main content | NOISE | Landmarks `header`/`nav`/`main`/`footer` exist; a one-screen QR menu on a phone. |
| B17 | call-sheet.tsx:239, dish-order.tsx:121 | name/autocomplete; placeholder ends with "…" | NOISE | Free-text notes in a bottom sheet, not a posted form. |
| B18 | call-sheet.tsx:248, pay-sheet.tsx:425 | Submit stays enabled | NOISE | Disabled until a choice is made is a deliberate pattern. |
| B19 | section.tsx:61 | Virtualize lists over 50 | NOISE | A menu is rendered whole on purpose (filters hide items, print, SEO); menus are a few hundred items at most. |
| B20 | category-rail.tsx:78 | No layout reads in render | NOISE | `offsetLeft` read is in an effect, not render. |
| B21 | header.tsx:71 | (aria-haspopup on trigger) | NOISE | Not in the rules; the item buttons have it. |
| B22 | face.tsx:194 | (inline `<style>`) | NOISE | Not a Vercel topic. |

Face totals: REAL 6 (B1 to B6), COVERED 9 (B7 to B15), NOISE 7 (B16 to B22).

## C. Found while reading, NOT by the Vercel rules (reviewer extras, unverified in a browser)

| # | file:line | Issue |
|---|---|---|
| E1 | template-gallery.tsx:114-117 | "Use" calls `setOpen(false)`, which closes the collapsible that holds the focused button, so keyboard focus falls to the page. |
| E2 | services/parts.tsx:90 | `<output key={value} aria-live="polite">` is re-created on every change; a freshly inserted live region is often not announced, so the quantity change may be silent. |

## Grand total (both screens)

REAL 10 (4 admin, 6 face; 6 of the 10 are in ordering/payment sheets that are off in D79), COVERED 9, NOISE 16, 2 extras outside the rules.

## Appendix B: UI UX Pro Max's generated design system

## Design System: Restro Admin

### Design Dials
- **Variance:** 2/10 — Centered / Minimal
- **Motion:** 2/10 — Subtle

### Pattern
- **Name:** Hero + Testimonials + CTA
- **Conversion Focus:** Social proof before CTA. Use a concise set of verified testimonials with photo, name, and role. CTA after social proof. Provide previous/next and pause controls; stop rotation on focus, hover, and reduced motion; announce slide position. Previous/next buttons and keyboard controls must expose every slide without dragging.
- **CTA Placement:** Hero (sticky) + Post-testimonials
- **Color Strategy:** Hero: Brand color. Testimonials: Light bg #F5F5F5. Quotes: Italic, muted color #666. CTA: Vibrant
- **Sections:** Hero > Problem statement > Solution overview > Testimonials carousel > CTA

### Style
- **Name:** Minimalism & Swiss Style
- **Mode Support:** Light supported | Dark supported
- **Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential
- **Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools
- **Performance:** cost:low|drivers:none | **Accessibility:** risk:low|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion

### Colors
| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E3A8A` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent/CTA | `#A16207` | `--color-accent` |
| On Accent/CTA | `#FFFFFF` | `--color-on-accent` |
| Background | `#F8FAFC` | `--color-background` |
| Foreground | `#1E40AF` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#1E40AF` | `--color-card-foreground` |
| Muted | `#E9EEF5` | `--color-muted` |
| Muted Foreground | `#475569` | `--color-muted-foreground` |
| Border | `#BFDBFE` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#1E3A8A` | `--color-ring` |

*Notes: Luxury navy + gold service [Accent adjusted from #CA8A04]*

### Typography
- **Heading:** Playfair Display SC
- **Body:** Karla
- **Mood:** restaurant, menu, culinary, elegant, foodie, hospitality
- **Best For:** Restaurants, cafes, food blogs, culinary, hospitality
- **Google Fonts:** https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display+SC:wght@400;700&display=swap
- **CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display+SC:wght@400;700&display=swap');
```

### Key Effects
Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Motion
**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`
```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```
*Framework notes: Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately*
- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback

### Avoid (Anti-patterns)
- Poor photos
- Complex booking

### Pre-Delivery Checklist
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
