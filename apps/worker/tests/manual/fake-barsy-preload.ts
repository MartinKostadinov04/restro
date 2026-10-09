// For a manual run of the real worker without the real barsy: preload this file into the worker
// process and the demo installation (the recordings in packages/barsy/fixtures/demo) answers for
// demo.barsyonline.com through MSW. Any other request fails, so nothing can leave the machine.
//
//   pnpm --filter @restro/worker exec tsx \
//     --env-file-if-exists=../../.env.local --env-file-if-exists=../../.env.worker.local \
//     --import ./tests/manual/fake-barsy-preload.ts src/index.ts
//
// then drive it with tests/manual/drive.ts (see its header). Not part of any test run.

import { makePng } from '../../../../packages/assets/src/test-images.ts'
import { createFakeBarsy } from '../fake-barsy.ts'

const fake = createFakeBarsy()
fake.password = process.env.MANUAL_BARSY_PASSWORD ?? 'demo-password'

// A few different small pictures, so that the photo job shows both stored and reused assets.
for (const article of fake.articles) {
  if (!article.picture_url) continue
  const url = new URL(String(article.picture_url))
  const size = 8 + (Number(article.article_id) % 5)
  fake.photos.set(`${url.pathname}${url.search}`, { status: 200, body: makePng(size, 8) })
}

fake.listen()
console.log(`[manual] MSW answers for ${fake.host}; every other request fails`)
