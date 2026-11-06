import { report, sleep, ARTIFACTS } from './common.mjs'
import path from 'node:path'

/** S3:导出/导入 JSON 往返;S4:草稿冲突横幅恢复/丢弃 */
export async function run(page) {
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('验证旅行一')
  await page.getByPlaceholder(/可输入任意字符/).fill('往返内容N1')
  await sleep(500)
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON' }).click(),
  ])
  const jsonPath = path.join(ARTIFACTS, 'export-roundtrip.json')
  await dl.saveAs(jsonPath)
  report('S3a 导出 JSON 下载成功', (await import('node:fs')).existsSync(jsonPath))

  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.locator('input[type="file"]').setInputFiles(jsonPath)
  await sleep(700)
  const nameVal = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
  const noteVal = await page.getByPlaceholder(/可输入任意字符/).inputValue()
  report('S3b 导入 JSON 后内容一致', nameVal === '验证旅行一' && noteVal === '往返内容N1', `name=${nameVal} note=${noteVal}`)

  // S4 冲突横幅:导入基线 → 编辑 → 再导入同一文件 → 横幅 → 恢复 → 再导入 → 丢弃
  await page.locator('input[type="file"]').setInputFiles(jsonPath)
  await sleep(700)
  const note = page.getByPlaceholder(/可输入任意字符/)
  await note.fill('冲突验证编辑')
  await sleep(500)
  await page.locator('input[type="file"]').setInputFiles(jsonPath)
  await sleep(700)
  const banner = page.getByText('检测到较新的本地草稿').first()
  const visible = await banner.isVisible().catch(() => false)
  report('S4a 再导入后出现草稿冲突横幅', visible)
  if (visible) {
    report('S4b basedOnCurrent 判定正确', (await page.getByText('包含尚未保存到文件的编辑').count()) === 1)
    await page.getByRole('button', { name: '恢复草稿' }).restore_placeholder
    await page.getByRole('button', { name: '恢复草稿' }).click()
    await sleep(400)
    report('S4c 恢复草稿内容正确', (await note.inputValue()) === '冲突验证编辑', await note.inputValue())
    await page.locator('input[type="file"]').setInputFiles(jsonPath)
    await sleep(700)
    await page.getByRole('button', { name: '丢弃草稿' }).click()
    await sleep(400)
    report('S4d 丢弃草稿恢复文件内容', (await note.inputValue()) === '往返内容N1', await note.inputValue())
  }
}
