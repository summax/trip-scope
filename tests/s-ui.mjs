import { report, sleep, url, DIST, EXAMPLE, ARTIFACTS } from './common.mjs'
import fs from 'node:fs'
import path from 'node:path'

/** S8 主题;S9 375px;S11 示例文件;S12 连续保存循环 */
export async function run(page) {
  // S8 主题切换
  const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const themeBtn = page.locator('button[title="切换主题"]')
  const before = await attr()
  await themeBtn.click()
  await sleep(200)
  const after = await attr()
  report('S8 主题切换 light→dark', before === 'light' && after === 'dark', `${before}→${after}`)
  await page.screenshot({ path: path.join(ARTIFACTS, 's8-dark.png') })
  await themeBtn.click()
  await sleep(200)
  report('S8b 切回浅色', (await attr()) === 'light')

  // S9 375px 无横向溢出
  await page.setViewportSize({ width: 375, height: 812 })
  await sleep(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  report('S9 375px 无横向溢出', overflow <= 1, `溢出 ${overflow}px`)
  await page.screenshot({ path: path.join(ARTIFACTS, 's9-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 800 })

  // S11 示例旅行 file:// 直接打开
  await page.goto(url(EXAMPLE))
  await sleep(600)
  const name = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
  report('S11 示例旅行 file:// 打开内容正确', name.includes('示例:2027 国庆云南(骨架演示)'), name)
  report('S11b 示例文件非只读', (await page.getByText('只读模式').count()) === 0)

  // S12 连续保存循环 ×3(下载→重开→再编辑→再保存)
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  const note = page.getByPlaceholder(/可输入任意字符/)
  await note.fill('循环基线')
  await sleep(400)
  let current = path.join(ARTIFACTS, 'cycle-1.html')
  const [d0] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /保存/ }).click(),
  ])
  await d0.saveAs(current)
  for (let i = 2; i <= 4; i++) {
    await page.goto(url(current))
    await sleep(600)
    const note = page.getByPlaceholder(/可输入任意字符/)
    await note.fill(`循环第${i}轮`)
    await sleep(500)
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /保存/ }).click(),
    ])
    const next = path.join(ARTIFACTS, `cycle-${i}.html`)
    await dl.saveAs(next)
    report(`S12 第${i - 1}轮 连续保存`, (await import('node:fs')).existsSync(next))
    current = next
  }
  const raw = fs.readFileSync(current, 'utf8')
  const m = raw.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)
  const parsed = JSON.parse(m[1])
  report('S12b 连续保存后数据一致', parsed.data.demo.note === '循环第4轮', parsed.data.demo.note)
  const nodes = (raw.match(/<script id="app-data" type="application\/json">[\s\S]*?<\/script>/g) || []).length
  report('S12c 多轮保存结构完好', nodes === 1, String(nodes))
}
