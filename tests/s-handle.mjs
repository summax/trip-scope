import { report, sleep, url, DIST, EXAMPLE, ARTIFACTS, FIXTURES } from './common.mjs'
import fs from 'node:fs'
import path from 'node:path'

/**
 * S13–S16:句柄模式与另存副本,通过 stub 替换 window.showSaveFilePicker /
 * showOpenFilePicker(逻辑全真,仅原生对话框被替身)。原生对话框真实 UX 仍属人工项。
 */
export async function run(page) {
  // 安装可配置 stub(每个导航前生效)
  await page.addInitScript(() => {
    window.__fs = {
      fileContent: null,
      fileName: 'trip.html',
      permission: 'granted',
      saved: null,
      externalChange: null,
    }
    window.showSaveFilePicker = async (opts) => ({
      name: opts?.suggestedName ?? 'stub.html',
      createWritable: async () => ({
        write: async (data) => {
          window.__savedContent = String(data)
        },
        close: async () => {},
      }),
    })
    window.showOpenFilePicker = async () => [
      {
        name: window.__fs.fileName,
        getFile: async () => {
          const text = window.__fs.externalChange ?? window.__fs.fileContent
          return new File([text], window.__fs.fileName, { type: 'text/html' })
        },
        queryPermission: async () => window.__fs.permission,
        requestPermission: async () => window.__fs.permission,
        createWritable: async () => ({
          write: async (data) => {
            window.__fs.saved = String(data)
          },
          close: async () => {
            window.__fs.externalChange = window.__fs.saved
          },
        }),
      },
    ]
  })

  const tripHtml = fs.readFileSync(EXAMPLE, 'utf8')

  /* S13 另存为副本(stub):新 UUID + 副本名 + 内容完整 */
  await page.goto(url(DIST))
  await sleep(600)
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)
  await page.getByPlaceholder(/2027 国庆云南旅行/).fill('副本源旅行')
  await sleep(400)
  await page.getByRole('button', { name: '另存为副本' }).click()
  await sleep(600)
  const saved = await page.evaluate(() => window.__savedContent)
  report('S13a 另存为副本调用保存选择器', !!saved && saved.length > 10000, saved ? `${saved.length} 字符` : '无')
  if (saved) {
    const node = JSON.parse(saved.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
    report('S13b 副本名带「副本」后缀', node.project.name === '副本源旅行 副本', node.project.name)
    report('S13c 副本为独立 UUID', node.project.id.length === 36 && node.project.id !== '8f7c2b1a-3d4e-4f5a-9b8c-1a2b3c4d5e6f', node.project.id.slice(0, 8))
    report('S13d 副本数据节点唯一', (saved.match(/<script id="app-data" type="application\/json">[\s\S]*?<\/script>/g) || []).length === 1)
  }
  await page.getByRole('button', { name: '新建旅行' }).first().click()
  await sleep(300)

  /* S14 句柄打开 + 写回原文件 */
  await page.evaluate((html) => {
    window.__fs.fileContent = html
    window.__fs.fileName = '示例旅行.html'
    window.__fs.permission = 'granted'
    window.__fs.externalChange = null
    window.__fs.saved = null
  }, tripHtml)
  await page.getByRole('button', { name: '打开文件' }).click()
  await sleep(700)
  report('S14a 句柄模式徽标出现', (await page.getByText('句柄模式(可写回原文件)').count()) === 1)
  report('S14a2 句柄模式文件名徽标显示当前文件(B1 回归)', (await page.getByText('示例旅行.html').count()) >= 1)
  const nameVal = await page.getByPlaceholder(/2027 国庆云南旅行/).inputValue()
  report('S14b 打开的是磁盘数据', nameVal.includes('示例:2027 国庆云南旅行'), nameVal)
  const nameInput = page.getByPlaceholder(/如:2027 国庆云南旅行/)
  await nameInput.fill('句柄写回编辑')
  await sleep(500)
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(600)
  const written = await page.evaluate(() => window.__fs.saved)
  report('S14c 写回发生', !!written, written ? `${written.length} 字符` : '无')
  if (written) {
    const node = JSON.parse(written.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
    report('S14d 写回内容含编辑', node.project.name === '句柄写回编辑', node.project.name)
    report('S14e 写回保持原 UUID', node.project.id === '8f7c2b1a-3d4e-4f5a-9b8c-1a2b3c4d5e6f', node.project.id.slice(0, 8))
    report('S14f 写回结构完好(节点唯一)', (written.match(/<script id="app-data" type="application\/json">[\s\S]*?<\/script>/g) || []).length === 1)
  }
  // 第二次保存:originalRaw 已更新,不应误报冲突
  await nameInput.fill('句柄写回编辑2')
  await sleep(500)
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(600)
  const conflictShown = await page.getByText('检测到文件在磁盘上已被外部修改').count()
  const secondSaved = await page.evaluate(() => window.__fs.saved ?? '')
  report('S14g 连续写回无误报冲突', conflictShown === 0 && secondSaved.includes('句柄写回编辑2'))

  /* S15 外部修改冲突 → 磁盘重载 */
  await page.evaluate(() => {
    const html = window.__fs.saved
    const m = html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)
    const node = JSON.parse(m[1])
    node.project.name = '磁盘被外部修改'
    const json = JSON.stringify(node, null, 2).replace(/</g, '\\u003c')
    window.__fs.externalChange = html.replace(m[0], `<script id="app-data" type="application/json">${json}</script>`)
  })
  await nameInput.fill('本地未保存编辑')
  await sleep(500)
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(600)
  report('S15a 外部修改触发冲突弹窗', (await page.getByText('检测到文件在磁盘上已被外部修改').count()) === 1)
  await page.getByRole('button', { name: '以磁盘最新为准重载' }).click()
  await sleep(700)
  const reloaded = await nameInput.inputValue()
  report('S15b 重载后内容为磁盘最新', reloaded === '磁盘被外部修改', reloaded)
  report('S15c 重载后仍是句柄模式', (await page.getByText('句柄模式(可写回原文件)').count()) === 1)

  /* S16 权限拒绝 → 降级下载副本 */
  await page.evaluate(() => {
    window.__fs.permission = 'denied'
  })
  await nameInput.fill('权限拒绝场景')
  await sleep(500)
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '保存到文件' }).click(),
  ])
  const degradePath = path.join(ARTIFACTS, 'degraded-copy.html')
  await dl.saveAs(degradePath)
  const raw = fs.readFileSync(degradePath, 'utf8')
  const node = JSON.parse(raw.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
  report('S16a 权限拒绝降级为下载副本', fs.existsSync(degradePath))
  report('S16b 降级副本含本地编辑', node.project.name === '权限拒绝场景', node.project.name)
  await page.evaluate(() => {
    window.__fs.permission = 'granted'
  })

  /* S17 v2 旧版文件 → 保存时升级确认三分支(R5 义务:首次迁移不得裸奔) */
  const v2Html = fs.readFileSync(path.join(FIXTURES, 'v2-trip.html'), 'utf8')
  await page.goto(url(DIST))
  await sleep(600)
  await page.evaluate((html) => {
    window.__fs.fileContent = html
    window.__fs.fileName = 'v2-trip.html'
    window.__fs.permission = 'granted'
    window.__fs.externalChange = null
    window.__fs.saved = null
  }, v2Html)
  await page.getByRole('button', { name: '打开文件' }).click()
  await sleep(700)
  report('S17a v2 文件打开即迁移(徽标显示 v3)', (await page.getByText(/数据版本 v3/).count()) >= 1)
  await page.getByPlaceholder(/如:2027 国庆云南旅行/).fill('v2 升级验证')
  await sleep(400)
  // 分支一:取消
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(500)
  report('S17b 升级确认弹层出现', (await page.getByText('本次保存将整体升级原文件').count()) === 1)
  await page.getByRole('button', { name: '取消' }).click()
  await sleep(400)
  const afterCancel = await page.evaluate(() => window.__fs.saved)
  report(
    'S17c 取消分支:不写回且弹层关闭',
    afterCancel === null && (await page.getByText('本次保存将整体升级原文件').count()) === 0,
  )
  // 分支二:另存为副本(原文件保持 v2 原样;句柄模式走保存选择器 stub)
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(400)
  await page.getByRole('button', { name: '另存为副本(保留原文件)' }).click()
  await sleep(700)
  const copyContent = await page.evaluate(() => window.__savedContent ?? '')
  const savedAfterCopy = await page.evaluate(() => window.__fs.saved)
  const copyNode = copyContent
    ? JSON.parse(copyContent.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
    : null
  report(
    'S17d 另存副本分支:原文件未写、副本为 v3 完整快照',
    savedAfterCopy === null && !!copyNode && copyNode.schemaVersion === 3,
    String(copyNode?.schemaVersion),
  )
  // 分支三:确认升级
  await page.getByRole('button', { name: '保存到文件' }).click()
  await sleep(400)
  await page.getByRole('button', { name: '确认升级并保存' }).click()
  await sleep(700)
  const upgraded = await page.evaluate(() => window.__fs.saved)
  const upNode = upgraded
    ? JSON.parse(upgraded.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
    : null
  report('S17e 确认升级分支:写回为 v3', !!upNode && upNode.schemaVersion === 3, String(upNode?.schemaVersion))
  report(
    'S17f 升级后数据保留(项目名)',
    upNode?.project?.name === 'v2 升级验证',
    upNode?.project?.name,
  )
}
