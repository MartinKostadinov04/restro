<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Restro menu faces self-contained and render only the resolved view model through the declared slot contract, because business rules belong to the upstream shell.
- Ordering UI (bag, tab, waiter call, payment, receipt) lives in `src/features/restro-face/ordering/` and receives data plus callbacks only via the face's optional `ordering` prop; without it the face stays browsing-only.
- Keep theme preset selection in the review shell and fixtures, never in the face; production receives resolved semantic roles from platform JSON so custom venue themes need no renderer changes.
- Keep external execution and authoritative reconciliation in the integrating platform adapter; callbacks are in-process boundaries, not direct POS/payment/network clients, so guest UI cannot grant itself business authority.
