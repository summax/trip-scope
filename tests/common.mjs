import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

export { sleep }

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURES = path.resolve(HERE, 'fixtures')
export const ARTIFACTS = path.resolve(HERE, 'artifacts')
export const REPO = path.resolve(HERE, '..')
export const DIST = path.join(REPO, 'dist', 'trip-scope.html')
export const EXAMPLE = path.join(REPO, 'examples', '示例旅行.html')

export const results = []
export function report(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

/** Windows 路径 → file:// URL(不含反斜杠字面量) */
export function url(p) {
  return 'file:///' + p.split(String.fromCharCode(92)).join('/')
}

/** 保存 download 到指定路径 */
export async function saveDownload(dl, p) {
  await dl.saveAs(p)
  return fs.existsSync(p)
}
