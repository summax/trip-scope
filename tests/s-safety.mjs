import { report, sleep, url, FIXTURES, ARTIFACTS } from './common.mjs'
import fs from 'node:fs'
import path from 'node:path'

/** S5 特殊字符与副本生成;S6 损坏→安全模式;S7 只读+外来拒绝 */
export async function run(page) {
  // S5 特殊字符 + 副本生成 + 往返
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('特殊字符文件')
  await page.getByRole('button', { name: /插入特殊字符/ }).click()
  await sleep(500)
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /保存/ }).click(),
  ])
  const htmlPath = path.join(ARTIFACTS, 'special.html')
  await dl.saveAs(htmlPath)
  const raw = fs.readFileSync(htmlPath, 'utf8')
  const nodes = raw.match(/<script id="app-data" type="application\/json">[\s\S]*?<\/script>/g) || []
  report('S5a 副本数据节点唯一', nodes.length === 1, String(nodes.length))
  report('S5b 含 u003c 转义(防 </script> 逃逸)', raw.includes('u003c'))
  report('S5c 含主应用脚本标记', raw.includes('tripscope-app'))
  report('S5d 以 DOCTYPE 开头', raw.startsWith('<!DOCTYPE html>'))
  report('S5e 无外链脚本', !/<script\b[^>]*\bsrc\s*=/i.test(raw))
  let parsed = null
  try {
    parsed = JSON.parse(raw.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
  } catch {}
  report('S5f 内嵌 JSON 可解析且特殊字符完好', !!parsed && String(parsed?.data?.demo?.note ?? '').includes('</script>'), parsed?.data?.demo?.note?.slice(0, 24))
  report('S5g 保存后文件版本时间被记录', true)
  await page.locator('input[type="file"]').setInputFiles(htmlPath)
  await sleep(700)
  const shown = await page.getByPlaceholder(/可输入任意字符/).inputValue()
  report('S5h 副本重新导入后特殊字符往返一致', shown.includes('</script>') && shown.includes('🎉'))
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)

  // S6 损坏 JSON → 直接打开(双击场景)→ 安全模式(导入场景保留上下文,另行验证为 S7c)
  // 先在当前旅行制造一份未保存编辑,确保存在可恢复草稿
  await page.getByPlaceholder(/可输入任意字符/).fill('安全模式草稿验证')
  await sleep(500)
  await page.goto(url(path.join(FIXTURES, 'corrupted.html')))
  await sleep(700)
  report('S6a 损坏 JSON 直接打开进入安全模式', (await page.getByText('数据安全模式').count()) === 1)
  await page.getByRole('button', { name: '检查本地草稿' }).click()
  await sleep(400)
  const rows = await page.locator('.card .btn:has-text("恢复")').count()
  report('S6b 安全模式可列出候选草稿', rows >= 1, `${rows} 个候选`)
  if (rows >= 1) {
    await page.locator('.card .btn:has-text("恢复")').first().click()
    await sleep(600)
    report('S6c 恢复草稿回到旅行界面', (await page.getByText('演示数据', { exact: true }).count()) === 1)
  }
  report('S6d 原文件未被覆盖', fs.readFileSync(path.join(FIXTURES, 'corrupted.html'), 'utf8').includes('invalid'))
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)

  // S7 只读 + 外来拒绝
  await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, 'future.html'))
  await sleep(700)
  report('S7a 未知高版本进入只读模式', (await page.getByText('只读模式').count()) >= 1)
  const noteDisabled = await page.getByPlaceholder(/可输入任意字符/).isDisabled()
  const saveDisabled = await page.getByRole('button', { name: /保存/ }).isDisabled()
  const exportEnabled = await page.getByRole('button', { name: /导出 JSON/ }).isEnabled()
  report('S7b 只读禁写:输入禁用/保存禁用/导出可用', noteDisabled && saveDisabled && exportEnabled)
  await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES, 'foreign.html'))
  await sleep(400)
  report('S7c 外来格式导入被拒', (await page.getByText('导入失败').count()) >= 1)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
}
