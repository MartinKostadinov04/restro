# barsy connector

The barsy connector: typed read client, mapping (versioned), fixture recorder (`pnpm barsy:record`, credentials from `.env.local`), MSW handlers. The root `CLAUDE.md` still applies.

- **POS calls:** every method in a connector (this one and any later one) has a comment with the official doc URL (barsy: `https://docs.lukanet.com/barsy.api/methods/...`) and is checked against it before implementation.
