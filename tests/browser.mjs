import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

/** 启动真实 Chrome(独立临时用户目录),返回 child process */
export function launchBrowser(port = 9223) {
  const exe = CHROME_CANDIDATES.find((p) => p.includes('.exe') && fs.existsSync(p))
  if (!exe) throw new Error('未找到 chrome.exe,请确认 Chrome 已安装')
  const userDataDir = path.join(HERE, '.browser-profile')
  fs.rmSync(userDataDir, { recursive: true, force: true })
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  return { child }
}

/** 轮询等待 CDP 端口就绪并连接 */
export async function connectBrowser(port = 9223) {
  let browser
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      return browser
    } catch {
      await sleep(500)
    }
  }
  throw new Error('CDP 端口等待超时')
}
