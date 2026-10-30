# Faces (guest menu templates)

Phone faces are templates (D69): a manifest plus React components. `editorial-market` is the renderer, the one face (D128), with a `./preview` demo host for the admin. Package layout: `README.md` → "Scaffold conventions". These rules also cover the template registry in `apps/web/src/faces`. The root `CLAUDE.md` still applies, its import boundaries for faces included.

- **Wiring:** a face is added to `MANIFESTS` in `apps/web/src/faces/manifests.ts` and gets a loader in `apps/web/src/faces/registry.ts`. Server code reads `manifests.ts`; only client code imports `registry.ts`.
- **Design:** a template is designed by an agent through the `template-design` skill from `docs/guides/menu-template-functionality.md` (what a guest can do in a menu; a change to it revises that file), and `template-review` reviews and wires it (D105). The flow is `.claude/skills/restro-flow/template.md`; the checklist is the designer guide's "A new template".
- **Service screens:** the guest template's service screens (bag, bill, call a waiter, pay, receipt) exist in the face (D71). Guests see them only once the platform supports them, and they follow D72: no local success.
- **Screenshots:** `FACES_VISUAL=1 FACES_VISUAL_FACE=<id> pnpm --filter @restro/web run test:e2e e2e/faces-visual.spec.ts` shoots one template's screenshot matrix into `apps/web/test-results/faces-visual/<id>/`.
