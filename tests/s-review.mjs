import { report, sleep, url, DIST, EXAMPLE, FIXTURES, ARTIFACTS } from './common.mjs'
import fs from 'node:fs'
import path from 'node:path'

/**
 * DeepSeek 审查回归:失败优先断言(H1/H3/H4/H5/M1/M2)。
 * 预期:修复前跑本文件应 FAIL,修复后应 PASS。
 */
export async function run(page) {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async (opts) => ({
      name: opts?.suggestedName ?? 'stub.html',
      createWritable: async () => ({
        write: async (data) => {
          window.__savedContent = String(data)
        },
        close: async () => {},
      }),
    })
  })

  /* RH1 示例文件时效性:examples 产物内的应用代码必须与当前源码等代 */
  await page.goto(url(EXAMPLE))
  await sleep(700)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('RH1改名')
  await sleep(300)
  await page.getByRole('button', { name: '另存为副本' }).click()
  await sleep(600)
  const rh1Saved = await page.evaluate(() => window.__savedContent)
  report('RH1 示例文件内应用代码可用(另存副本成功)', !!rh1Saved && rh1Saved.length > 10000, rh1Saved ? `${rh1Saved.length} 字符` : '静默失败(过期产物)')

  /* RH3 空白工具刷新后未保存草稿可恢复 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/可输入任意字符/).fill('H3未保存内容')
  await page.waitForTimeout(150)
  await page.reload()
  await sleep(700)
  const rh3Note = await page.getByPlaceholder(/可输入任意字符/).inputValue()
  report('RH3 新建旅行后刷新,未保存草稿可恢复', rh3Note === 'H3未保存内容', `note=${rh3Note}`)

  /* RH4 仅改名也应触发草稿恢复(整节点比对) */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('N1')
  await page.getByPlaceholder(/可输入任意字符/).fill('D1')
  await sleep(600)
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON' }).click(),
  ])
  const rh4Json = path.join(ARTIFACTS, 'rh4.json')
  await dl.saveAs(rh4Json)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.locator('input[type="file"]').setInputFiles(rh4Json)
  await sleep(700)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('H4改名后')
  await page.waitForTimeout(600)
  await page.locator('input[type="file"]').setInputFiles(rh4Json)
  await sleep(700)
  const rh4Banner = await page.getByText('检测到较新的本地草稿').count()
  report('RH4a 仅改名(数据未动)也触发草稿恢复', rh4Banner >= 1)
  if (rh4Banner >= 1) {
    await page.getByRole('button', { name: '恢复草稿' }).click()
    await sleep(400)
    const n = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
    report('RH4b 恢复后项目名为改名值', n === 'H4改名后', n)
  }

  /* RH5 安全模式恢复也必须过准入(v99 草稿 → 只读) */
  await page.goto(url(DIST))
  await sleep(600)
  await page.evaluate(() => {
    const now = new Date().toISOString()
    const entry = {
      node: {
        format: 'tripscope',
        schemaVersion: 99,
        project: { id: 'v99draft', name: 'H5只读草稿' },
        updatedAt: now,
        appVersion: 'future',
        data: { demo: { note: 'v99' } },
      },
      savedAt: now,
      baseUpdatedAt: null,
    }
    localStorage.setItem('tripscope:draft:v99draft', JSON.stringify(entry))
  })
  await page.goto(url(path.join(FIXTURES, 'corrupted.html')))
  await sleep(700)
  await page.getByRole('button', { name: '检查本地草稿' }).click()
  await sleep(400)
  const row = page.locator('div.rounded-lg.border', { hasText: 'H5只读草稿' }).getByRole('button', { name: '恢复' })
  await row.click()
  await sleep(700)
  const rh5Banner = await page.getByText('只读模式').count()
  const rh5Disabled = await page.getByPlaceholder(/可输入任意字符/).isDisabled()
  report('RH5 v99 草稿恢复进入只读模式', rh5Banner >= 1 && rh5Disabled, `banner=${rh5Banner} disabled=${rh5Disabled}`)

  /* RM1 项目名尾随空格不被吞 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  const name = page.getByPlaceholder(/2027 国庆云南旅行/)
  await name.fill('')
  await name.pressSequentially('AB')
  await name.pressSequentially(' ')
  await name.pressSequentially('C')
  const rm1 = await name.inputValue()
  report('RM1 项目名尾随空格保留', rm1 === 'AB C', `value=${rm1}`)

  /* RM2 上下文切换时,排期中的草稿按排期时快照写入正确键 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/可输入任意字符/).fill('M2排期快照内容')
  await page.getByRole('button', { name: '新建旅行' }).click()
  await page.waitForTimeout(500)
  const found = await page.evaluate(() => {
    const hits = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('tripscope:draft:') && (localStorage.getItem(k) || '').includes('M2排期快照内容')) hits.push(k)
    }
    return hits
  })
  report('RM2 切换上下文后排期草稿按原旅行写入', found.length >= 1, JSON.stringify(found))
}
