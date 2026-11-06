import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const DIST = path.join(REPO, 'dist', 'trip-scope.html')
const OUT = path.join(HERE, 'fixtures')
mkdirSync(OUT, { recursive: true })

export function makeFixtures() {
  const html = readFileSync(DIST, 'utf8')

function replaceNode(src, json) {
  const RE = /<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/g
  const hits = [...src.matchAll(RE)]
  if (hits.length !== 1) throw new Error(`数据节点命中 ${hits.length},应为 1`)
  return src.replace(RE, () => `<script id="app-data" type="application/json">${json}</script>`)
}

// 1) 损坏 JSON:安全模式
writeFileSync(path.join(OUT, 'corrupted.html'), replaceNode(html, '{invalid json'), 'utf8')

// 2) 未知更高版本:只读模式
const futureNode = {
  format: 'tripscope',
  schemaVersion: 99,
  project: { id: 'aaaa1111-0000-4000-8000-000000009999', name: '未来版本验证' },
}
futureNode.updatedAt = new Date().toISOString()
futureNode.appVersion = 'future'
futureNode.data = { demo: { note: '未来版本数据' } }
const futureJson = JSON.stringify(futureNode, null, 2).replace(/</g, '\\u003c')
writeFileSync(path.join(OUT, 'future.html'), replaceNode(html, futureJson), 'utf8')

// 3) 外来格式:导入被拒
const foreignNode = {
  format: 'otherapp',
  schemaVersion: 1,
  project: { id: 'bbbb1111-0000-4000-8000-000000009999', name: '外来文件' },
  updatedAt: new Date().toISOString(),
  appVersion: 'other',
  data: {},
}
const foreignJson = JSON.stringify(foreignNode, null, 2).replace(/</g, '\\u003c')
writeFileSync(path.join(OUT, 'foreign.html'), replaceNode(html, foreignJson), 'utf8')

  console.log('[fixtures] corrupted.html / future.html / foreign.html 已生成于 tests/fixtures/')
}