import { report, sleep, url, DIST, FIXTURES } from './common.mjs'
import path from 'node:path'

/**
 * r2 复审回归:失败优先断言(N1 草稿箱 / N2 同步异常 / N3 恢复不谎报)。
 */
export async function run(page) {
  /* RN1 草稿箱:旧未保存草稿可达、可恢复、可删除 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('RN1旧旅行')
  await page.getByPlaceholder(/可输入任意字符/).fill('旧内容')
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('RN1新旅行')
  await sleep(600)
  await page.reload()
  await sleep(700)
  const newestName = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
  report('RN1a 刷新恢复最新未保存草稿', newestName === 'RN1新旅行', newestName)
  // 按钮可能不存在(修复前),点击失败不阻塞后续断言
  await page.getByRole('button', { name: '草稿箱' }).click({ timeout: 2000 }).catch(() => {})
  await sleep(400)
  const oldRow = page.locator('div.rounded-lg.border', { hasText: 'RN1旧旅行' })
  report('RN1b 草稿箱可见旧未保存草稿', (await oldRow.count()) >= 1)
  if ((await oldRow.count()) >= 1) {
    await oldRow.getByRole('button', { name: '恢复' }).click()
    await sleep(600)
    const restored = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
    report('RN1c 从草稿箱恢复旧旅行', restored === 'RN1旧旅行', restored)
    // 删除链路
    await page.getByRole('button', { name: '草稿箱' }).click()
    await sleep(300)
    const row2 = page.locator('div.rounded-lg.border', { hasText: 'RN1新旅行' })
    const before = await page.locator('div.rounded-lg.border', { hasText: '旅行' }).count()
    await row2.getByRole('button', { name: '删除' }).click()
    await sleep(300)
    const after = await page.locator('div.rounded-lg.border', { hasText: '旅行' }).count()
    report('RN1d 草稿箱删除生效', after === before - 1, `${before}→${after}`)
    await page.getByRole('button', { name: '关闭' }).click({ timeout: 2000 }).catch(() => {})
    await sleep(300)
  }

  /* RN2 定时器内同步异常也有可见反馈 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('N2同步异常探测')
    }, 30)
  })
  await sleep(600)
  const rn2Toast = await page.locator('.fixed.bottom-6').textContent().catch(() => '')
  report('RN2 定时器内同步 throw 出现 toast', (rn2Toast ?? '').includes('操作失败'), rn2Toast ?? '(无 toast)')

  /* RN3 损坏草稿的恢复不得谎报成功 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem(
      'tripscope:draft:rn3broken',
      JSON.stringify({
        node: {
          format: 'tripscope',
          schemaVersion: 'bad',
          project: { id: 'rn3broken', name: 'RN3损坏草稿' },
          updatedAt: now,
          appVersion: 'x',
          data: {},
        },
        savedAt: now,
        baseUpdatedAt: null,
      }),
    )
  })
  await page.goto(url(path.join(FIXTURES, 'corrupted.html')))
  await sleep(700)
  await page.getByRole('button', { name: '检查本地草稿' }).click()
  await sleep(400)
  const rn3Row = page.locator('div.rounded-lg.border', { hasText: 'RN3损坏草稿' })
  await rn3Row.getByRole('button', { name: '恢复' }).click()
  await sleep(600)
  const stillSafe = await page.getByText('数据安全模式').count()
  const rn3Toast = await page.locator('.fixed.bottom-6').textContent().catch(() => '')
  report('RN3 损坏草稿恢复不离开安全模式且不谎报成功', stillSafe >= 1 && !(rn3Toast ?? '').includes('已恢复草稿'), `safe=${stillSafe} toast=${rn3Toast ?? '无'}`)

  /* RN4 删除"当前正在编辑"的草稿不被 pendingDraft 复活。
     设计:先开草稿箱让行渲染,再用**同一个 evaluate**完成"编辑+删除"——
     两动作间隔是页内 JS 执行耗时(微秒级),必然落在 debounce 窗口内,不依赖 sleep 编时序。
     判别力已经突变验证:注释掉 store.ts 的 pendingDraft 守卫,本断言变红。 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('RN4当前旅行')
  await sleep(600) // 草稿已落盘,行可见
  await page.getByRole('button', { name: '草稿箱' }).first().click()
  await sleep(300) // 面板行已渲染
  // 编辑与删除在同一 evaluate 内完成:间隔为页内 JS 执行耗时,必然 < debounce 窗口
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="可输入任意字符"]')
    input.value = '制造pending的编辑'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const rows = [...document.querySelectorAll('div.rounded-lg.border')]
    const row = rows.find((r) => r.textContent?.includes('RN4当前旅行'))
    const del = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('删除'))
    del?.click()
  })
  await sleep(1500) // 越过 debounce 时刻,观察是否被排期快照复活
  const rn4Resurrect = await page.evaluate(() => {
    const hits = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('tripscope:draft:') && (localStorage.getItem(k) || '').includes('RN4当前旅行')) hits.push(k)
    }
    return hits
  })
  report('RN4 删除当前编辑草稿不被排期快照复活', rn4Resurrect.length === 0, JSON.stringify(rn4Resurrect))
}
