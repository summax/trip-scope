import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * 从构建产物生成示例旅行 HTML。
 * 注意:节点读写逻辑与 src/core/schema.ts 保持一致(严格边界、`<` 转义)。
 */

// 与 src/core/schema.ts 的 NODE_RE 保持同构:`[/]` 字符类防自匹配,分组 1=开标签,2=数据
const RE = /(<script id="app-data" type="application[/]json">)([\s\S]*?)<\/script>/g

const html = readFileSync(new URL('../dist/trip-scope.html', import.meta.url), 'utf8')

const matches = [...html.matchAll(RE)]
if (matches.length !== 1) {
  throw new Error(`数据节点命中数必须为 1,实际 ${matches.length},产物结构异常`)
}

const node = {
  format: 'tripscope',
  schemaVersion: 1,
  project: {
    id: '8f7c2b1a-3d4e-4f5a-9b8c-1a2b3c4d5e6f',
    name: '示例:2027 国庆云南(骨架演示)',
  },
  updatedAt: new Date().toISOString(),
  appVersion: '示例',
  data: {
    demo: {
      note: '特殊字符验证:</script> 🎉 <b>粗体</b> "引号" 「方括号」',
      countA: 2,
      countB: 3,
      items: [
        { id: 'i1', label: '示例条目 · 机票', qty: 2 },
        { id: 'i2', label: '示例条目 · 酒店', qty: 1 },
      ],
    },
  },
}

const json = JSON.stringify(node, null, 2).replace(/</g, '\\u003c')
// 仅替换分组 1(开标签)之后的内容,保留开标签原文
const out = html.replace(RE, (_m, open) => open + json + '</script>')

mkdirSync(new URL('../examples/', import.meta.url), { recursive: true })
writeFileSync(new URL('../examples/示例旅行.html', import.meta.url), out, 'utf8')
console.log('[example] examples/示例旅行.html 已生成')
