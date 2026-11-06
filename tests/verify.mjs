import { report, results, sleep, DIST, ARTIFACTS } from './common.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser, connectBrowser } from './browser.mjs'
import { makeFixtures } from './make-fixtures.mjs'
import * as sLoad from './s-load.mjs'
import * as sData from './s-data.mjs'
import * as sSafety from './s-safety.mjs'
import * as sUi from './s-ui.mjs'
import * as sHandle from './s-handle.mjs'
import * as sReview from './s-review.mjs'
import * as sReview2 from './s-review2.mjs'
import * as sFeel from './s-feel.mjs'

async function startBrowser() {
  // Windows/Hyper-V 会保留部分端口区段,逐个尝试直至 CDP 就绪
  for (const port of [18888, 25117, 30941, 41239]) {
    const { child } = launchBrowser(port)
    try {
      const browser = await connectBrowser(port)
      return { child, browser }
    } catch {
      child.kill()
    }
  }
  throw new Error('所有候选端口均无法建立 CDP 连接')
}

async function main() {
  makeFixtures()
  const { child, browser } = await startBrowser()
  const context = browser.contexts()[0]
  const page = await context.newPage()

  try {
    await sLoad.run(page)
    await sData.run(page)
    await sSafety.run(page)
    await sUi.run(page)
    await sHandle.run(page)
    await sReview.run(page)
    await sReview2.run(page)
    await sFeel.run(page)
  } catch (e) {
    report('X 运行异常中断', false, String(e?.message ?? e))
    await page.screenshot({ path: path.join(ARTIFACTS, 'x-error.png') }).catch(() => {})
  }

  const pass = results.filter((r) => r.pass).length
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`)
  fs.writeFileSync(path.join(ARTIFACTS, 'report.json'), JSON.stringify(results, null, 2))
  await browser.close()
  child.kill()
  process.exit(pass === results.length ? 0 : 1)
}

main()
