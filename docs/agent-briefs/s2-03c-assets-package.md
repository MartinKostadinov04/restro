# Brief S2-03c: move the asset store into `packages/assets`

- **Model:** Haiku. This is a mechanical move: no new behaviour and no design choices. If anything below does not match what you find, **stop and report**; don't improvise.
- **Branch:** your worktree branch from `s2/composer`.
- **Why:** the worker (S2-03b) must store barsy photos with the same store the web app uses. The worker may not import from `apps/web`, so the store moves into a package that both can use.

## Exact steps
1. **Create the package `packages/assets`**, copying the shape of `packages/barsy`:
   - **`package.json`:** `name` `@restro/assets`; `private: true`; `type: module`; `exports` `{ ".": "./src/index.ts" }`; `scripts.typecheck` = `tsc --noEmit`.
   - **Dependencies:** `@restro/core` (`workspace:*`), `zod` `4.6.5`, `@aws-sdk/client-s3` `3.1146.0`, `@aws-sdk/s3-request-presigner` `3.1146.0`, all exact versions.
   - **`tsconfig.json`:** a copy of `packages/barsy/tsconfig.json`.
2. **Move with `git mv`** these files from `apps/web/src/server/assets/` to `packages/assets/src/`:
   - `types.ts`, `config.ts`, `local-store.ts`, `local-store.test.ts`, `r2-store.ts`, `r2-store.test.ts`;
   - `signing.ts`, `keys.ts`, `inspect-image.ts`, `inspect-image.test.ts`, `test-images.ts`.
   - **Exception:** `local-store.test.ts` imports `./serve-local`, which stays in the web app. Remove only the test cases that use `serve-local`, and move them into a new `apps/web/src/server/assets/serve-local.test.ts` that imports the store from `@restro/assets`. Keep every assertion unchanged.
3. **Create `packages/assets/src/create-store.ts`:** move the `createAssetStore(config, signingSecret)` function out of `apps/web/src/server/assets/index.ts` into it, unchanged (keep the lazy `import('./r2-store')`).
4. **Create `packages/assets/src/index.ts`:** re-export the public pieces:
   - everything exported from `types.ts`, `config.ts`, `keys.ts`, `inspect-image.ts` and `create-store.ts`;
   - `LocalAssetStore` from `local-store.ts`;
   - the exports of `signing.ts`.
   - Do **not** export `R2AssetStore` directly (it stays lazy-loaded), and do not export `test-images.ts` (tests import it by relative path).
5. **These stay in `apps/web/src/server/assets/`** and change their imports from `./types`, `./config`, `./local-store`, `./signing`, `./keys`, `./inspect-image` to `@restro/assets`:
   - `index.ts` (keeps `getAssetStore` and `getLocalAssetStore`, now importing `createAssetStore` from `@restro/assets`);
   - `upload.ts`, `upload-handler.ts`, `serve-local.ts`, `upload.test.ts`, `config.test.ts`.
6. **Update the other importers:**
   - `apps/web/e2e/item-sheet.spec.ts` imports `../src/server/assets/test-images`; change it to `../../../packages/assets/src/test-images`.
   - Search the repo for any other `server/assets/<moved file>` import and fix it.
7. **`apps/web/package.json`:** remove `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, and add `"@restro/assets": "workspace:*"`.
8. **`apps/web/next.config.*`:** add `'@restro/assets'` to `transpilePackages`.
9. **`.dependency-cruiser.cjs`:** add one rule, written like the existing ones. `packages/assets` must not import `@restro/db`, `@restro/barsy` or anything under `apps/`. Also add `packages/assets` / `@restro/assets` to the paths that `packages/shell` and `packages/faces/*` must not import, in the existing shell rule.
10. **Install and verify:** run `pnpm install`, so the lockfile updates.

## Done when
- `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass.
- The DB tests need no change. Run them only if a local Postgres is already running on 54329: `CI=true` plus the `DATABASE_URL*` values from `.env.example`. Otherwise say they were skipped.
- No test assertion was changed (only import paths). `git diff --stat -M` shows the moves as renames.

## Never / scope
- **Scope:** only the files named above. No refactors and no renames beyond those listed.
- **Behaviour:** don't change any behaviour or test assertion.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`; never push.
- **Report:** in `docs/agent-briefs/_template.md` format, short.
