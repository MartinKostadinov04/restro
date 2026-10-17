# Faces (templates)

Phone faces = templates (D69): a manifest plus React components. `editorial-market` is the default (with a `./preview` demo host for the admin); `qr-phone` is the hidden test reference. Root `CLAUDE.md` holds the import boundaries for faces.

- **Wiring:** a face is added to `MANIFESTS` in `apps/web/src/faces/manifests.ts` and gets a loader in `apps/web/src/faces/registry.ts`. Server code reads `manifests.ts`; only client code imports `registry.ts`.
- **Design:** an agent designs a template through the `template-design` skill from `docs/guides/menu-template-functionality.md` (what a guest can do in a menu; a change to it revises that file), and `template-review` reviews and wires it (D105). The flow is `.claude/skills/restro-flow/template.md`; the checklist is the designer guide's "A new template".
- **Screenshots:** `FACES_VISUAL=1 FACES_VISUAL_FACE=<id> pnpm --filter @restro/web run test:e2e e2e/faces-visual.spec.ts` shoots one template's screenshot matrix into `apps/web/test-results/faces-visual/<id>/`.
