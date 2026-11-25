# Web app (admin, guest shell, small API)

The root `CLAUDE.md` still applies. Templates (`src/faces`) and the guest service screens: `packages/faces/CLAUDE.md`.

- **Next.js 16.4 is newer than your training data.** Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- **Data fetching (U4):** admin = server components for reads, server actions that call `apply()` for writes. Guest = static shell that reads published files from the CDN.
- **One field-type registry.** Each field type registers `{ schema, Display, Editor, DefinitionEditor }` once; components look a type up in the registry rather than switching over field types.
- **i18n:** every interface string goes through next-intl (BG + EN) and names the POS with `{source}` (D82). Menu text comes from the document's `localized_text`.
