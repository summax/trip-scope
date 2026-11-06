import { report, sleep, url, DIST, EXAMPLE, ARTIFACTS } from './common.mjs'
import path from 'node:path'
import fs from 'node:fs'

/**
 * F 系列:批次 E 手感层——文件名徽标、未保存标记、Ctrl+S、重连栏不误现。
 * 真实句柄持久化重连(真实 FileSystemFileHandle + IndexedDB)需要原生对话框,
 * 属人工验收项;此处用替身句柄验证:持久化失败不崩溃、重连栏不误现。
 */
export async function run(page) {
  /* F1 嵌入模式显示宿主文件名徽标(先清前面套件遗留草稿,避免 RN3 残留损坏草稿把空白工具带进安全模式) */
  await page.evaluate(() => {
    try { localStorage.clear() } catch {}
  })
  await page.goto(url(DIST))
  await sleep(600)
  report('F1 嵌入模式显示宿主文件名徽标', (await page.getByText('trip-scope.html').count()) >= 1)

  /* F2-F3 基于文件型旅行(打开时非脏)验证未保存标记与 Ctrl+S */
  await page.goto(url(EXAMPLE))
  await sleep(600)
  const dirtyBefore = await page.getByText('未保存').count()
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('F2改名')
  await sleep(400)
  const dirtyAfter = await page.getByText('未保存').count()
  report('F2 编辑后出现未保存标记', dirtyBefore === 0 && dirtyAfter >= 1, `before=${dirtyBefore} after=${dirtyAfter}`)
  report('F2b document.title 含未保存', (await page.title()).includes('未保存'), await page.title())

  /* F3 Ctrl+S = 嵌入模式保存 → 下载副本;保存后未保存标记消失 */
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ])
  report('F3 Ctrl+S 触发保存(下载副本)', !!dl && dl.suggestedFilename().endsWith('.html'), dl ? dl.suggestedFilename() : '无')
  await dl.saveAs(path.join(ARTIFACTS, 'feel-ctrl-s.html')).catch(() => {})
  await sleep(500)
  report('F3b 保存后未保存标记消失', (await page.getByText('未保存').count()) === 0)

  /* F4 干净环境(替身句柄无法克隆入 IDB)重连栏不误现;全程无崩溃 */
  const barCount = await page.getByText('上次会话在编辑').count()
  report('F4 替身句柄场景重连栏不误现且无崩溃', barCount === 0)

  /* F5 新建旅行后徽标仍锚定宿主文件 */
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  report('F5 新建旅行后徽标仍显示宿主文件', (await page.getByText('示例旅行.html').count()) >= 1)

  /* F6 可克隆句柄正向路径(B1+B2):首次句柄打开 → 文件名徽标立即正确;
     刷新 → 邀请条出现且文件名正确;克隆句柄缺方法 → 重连优雅降级为权限 toast。
     句柄替身函数属性用不可枚举 defineProperty,structuredClone 仅克隆可枚举数据即可入 IDB。 */
  const tripHtml = fs.readFileSync(EXAMPLE, 'utf8')
  await page.goto(url(DIST))
  await sleep(600)
  await page.evaluate((html) => {
    const stub = {
      name: 'f6-reconnect.html',
      getFile: async () => new File([html], 'f6-reconnect.html', { type: 'text/html' }),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    }
    for (const [k, v] of Object.entries(stub)) {
      if (typeof v === 'function') Object.defineProperty(stub, k, { value: v, enumerable: false })
    }
    window.showOpenFilePicker = async () => [stub]
  }, tripHtml)
  await page.getByRole('button', { name: '打开文件' }).click()
  await sleep(700)
  report('F6a 首次句柄打开,文件名徽标立即正确(B1 回归)', (await page.getByText('f6-reconnect.html').count()) >= 1)
  await page.reload()
  await sleep(800)
  let f6BarText = ''
  const f6BarCount = await page.getByText('上次会话在编辑').count()
  if (f6BarCount > 0) f6BarText = (await page.getByText('上次会话在编辑').first().textContent()) ?? ''
  report('F6b 刷新后邀请条出现且文件名正确', f6BarCount === 1 && f6BarText.includes('f6-reconnect.html'), f6BarText || '无')
  await page.getByRole('button', { name: '重新连接' }).click()
  await sleep(600)
  const f6Toast = await page.locator('.fixed.bottom-6').textContent().catch(() => '')
  report('F6c 克隆句柄缺方法 → 优雅降级为权限 toast 而非崩溃', (f6Toast ?? '').includes('未重连'), f6Toast ?? '无')
}
