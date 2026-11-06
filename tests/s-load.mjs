import { report, url, sleep, DIST, ARTIFACTS, REPO } from './common.mjs'
import path from 'node:path'
import fs from 'node:fs'

const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))

/** S1:file:// 打开 + 快照校验 + 版本显示;S2:草稿延续 */
export async function run(page) {
  await page.goto(url(DIST))
  await page.waitForLoadState('domcontentloaded')
  await sleep(600)
  report('S1a file:// 双击打开,页面加载', (await page.title()).includes('TripScope'), await page.title())
  report('S1b 嵌入模式徽标', (await page.getByText('嵌入模式(保存=下载副本)').count()) === 1)
  report('S1c 快照自校验通过(无受限横幅)', (await page.getByText('副本生成能力受限').count()) === 0)
  report('S1d 版本显示与 package.json 同步', (await page.getByText(`TripScope v${PKG.version}`).count()) >= 1)
  await page.screenshot({ path: path.join(ARTIFACTS, 's1-light.png') })

  // S2 草稿延续
  const note = page.getByPlaceholder(/可输入任意字符/)
  const counts = page.locator('input[type="number"]')
  await note.fill('草稿B2')
  await counts.nth(0).fill('3')
  await sleep(500)
  await page.reload()
  await sleep(600)
  const v = await note.inputValue()
  const a = await counts.nth(0).inputValue()
  report('S2 编辑→刷新→草稿自动恢复', v === '草稿B2' && a === '3', `note=${v} countA=${a}`)
  await page.reload()
  await sleep(600)
  report('S2b 二次刷新仍延续', (await note.inputValue()) === '草稿B2')
}
