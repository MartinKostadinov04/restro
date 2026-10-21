# Restro overrides to the pinned web interface guidelines

Read with `web-interface-guidelines.pinned.md`. **Where a pinned rule and a line here differ, this file wins** (D106). The pinned file stays a diffable copy of upstream, so every Restro change is here.

"Applies to" says where the pinned rule still holds: *faces* (guest templates), *admin* (the owner's screens), *host* (the guest page and the admin frame around a face), *both*, or *neither*. A finding against a pinned rule that this file excludes for that surface is dropped.

## Real conflicts (check these first)

| # | Pinned rule | Applies to | Restro rule |
|---|---|---|---|
| 1 | Dates and times: "use `Intl.DateTimeFormat`". Numbers and currency: "use `Intl.NumberFormat`". The anti-pattern "Hardcoded date/number formats (use `Intl.*`)". The hydration rule on date rendering. | neither (admin: money and time only through the shared modules) | A face writes no `Intl`, `toFixed`, `new Date` or arithmetic on an amount, and prints `price.text` as given (§5.3, §9.1). In the admin, money goes through the `money` module only (CLAUDE.md rule 8) and time through date-fns in the venue's time zone. Flag `Intl` on money or time as a defect. |
| 2 | Text containers handle long content: "`truncate`, `line-clamp-*`, or `break-words`". | faces: only `break-words` | A name is never cut, in any template: wrap it. A description may be cut only where a visible control opens the rest (§7.5, R9). Flag `truncate`, `text-overflow: ellipsis` and `line-clamp` on a name. |
| 3 | "Large lists (>50 items): virtualize (`virtua`, `content-visibility: auto`)". The anti-pattern "Large arrays `.map()` without virtualization". | admin; never a face | Every item is in the markup, all 300 of them, none drawn twice or skipped (§9.5), and `virtua` is a dependency a face may not add. `content-visibility: auto` is allowed if the contract tests stay green. |
| 18 | Animation: "Honor `prefers-reduced-motion` (provide reduced variant or disable)"; "Autoplay motion >5 seconds… needs pause, stop, or hide controls"; "Muted decorative loops must stop under `prefers-reduced-motion`" | faces: as the Restro rule | "A reduced variant" means off: under reduced motion every animation, transition and smooth scroll stops (§7.5, A2 of `review-animations.restro-overrides.md`). A face has no loops at all, so pause controls never arise: flag any loop (D109). |

## Rules that do not apply to a face

| # | Pinned rule | Applies to | Restro rule or reason |
|---|---|---|---|
| 4 | "URL reflects state"; "Deep-link all stateful UI" (`nuqs`) | admin | A face has no URLs of its own and only UI state; the host owns the URL. The only addresses a face writes are the dish page and the sheets (`#item-<id>`, `#bag`, …, §10.2). |
| 5 | `color-scheme: dark` on `<html>`; `<meta name="theme-color">`; `overscroll-behavior: none` on `<html>`; `<link rel="preconnect">`; `translate="no"` on brand names | admin and host | Host-only page rules. A face never selects `html`, `body` or `:root` (§7.5). |
| 6 | "Critical fonts: `<link rel="preload" as="font">` with `font-display: swap`" | host | A face loads no font; the host serves the venue's six (§7.5, §9.1). |
| 7 | Above-fold images: "`priority` or `fetchpriority="high"`" | admin | `priority` is a Next.js `Image` prop. A face uses a plain `img` with `srcset` over `image.variants`, and `width` and `height` from `sourceWidth` and `sourceHeight` (§9.5). |
| 8 | "Detect language via `Accept-Language` / `navigator.languages`, not IP" | host | The language comes from the venue's policy and the host's `languages` prop; a face never detects it (§7.6). |
| 9 | "Headings hierarchical…; include skip link for main content"; "Interactive elements need keyboard handlers (`onKeyDown`/`onKeyUp`)" | skip link: host; handlers: both | A skip link is the host's; inside the admin's phone frame it would duplicate. A native `button` or `a` needs no handler: flag a redundant `onKeyDown` on one, and a missing handler only on a non-native control. |
| 10 | "Curly quotes `“` `”` not straight `"`" | English strings | Bulgarian quotation marks are „ “. Check them in the Bulgarian strings (`copy-rules.md`). |
| 11 | "Buttons/links need `hover:` state" | admin | A phone has no hover and it never carries meaning; allergens are never hover-dependent (§7.5). A face needs focus and pressed states. |
| 12 | The media rules: captions, autoplay, video, MP4 | neither on a face | A menu face has no video or audio. |
| 13 | Tailwind class names in the examples (`focus-visible:ring-*`, `min-w-0`, `line-clamp`, `overflow-x-hidden`) | faces: as CSS ideas | Read them as the CSS they stand for; a face is plain CSS (§9.1). |

## Admin notes

| # | Pinned rule | Applies to | Check |
|---|---|---|---|
| 14 | "Warn before navigation with unsaved changes (`beforeunload` or router guard)" | admin, only where a screen has no autosave | First read the screen's saving model (composer autosave and drafts, or a Save button). Report a defect only where unsaved work can be lost. |
| 15 | "Native `<select>`: explicit `background-color` and `color`" | admin, only a native `<select>` | Restro's selects are Radix; a finding needs a native `<select>` in the diff. |
| 16 | "Prefer uncontrolled inputs; controlled inputs must be cheap per keystroke" | admin | Low value: react-hook-form works either way. Report only a measurable keystroke lag. |
| 17 | "`autoFocus` sparingly…" | admin | shadcn dialogs focus themselves. Report `autoFocus` outside a dialog or on mobile. |
