import { describe, expect, test } from 'vitest'
import {
  canonicalJson,
  findDataNode,
  nodeContentSignature,
  parseNodeJson,
  replaceDataNode,
  sanitizeFileName,
  serializeNode,
  validateSnapshotHtml,
  blankNode,
  type TripNode,
} from '../../src/core/schema'

function node(overrides: Partial<TripNode> = {}): TripNode {
  const n = blankNode()
  Object.assign(n, overrides)
  return n
}

function page(dataJson: string, open = '<script id="app-data" type="application/json">'): string {
  return `<!DOCTYPE html><html><head><style>body{color:#fff}</style></head><body><div>x</div>${open}${dataJson}</script></body></html>`
}

describe('serializeNode:< 转义', () => {
  test('数据中的 </script> 被转义,JSON.parse 自动还原', () => {
    const n = node()
    n.data = { demo: { note: '</script><b>粗体</b>' } }
    const json = serializeNode(n)
    expect(json).not.toContain('<')
    const back = JSON.parse(json) as TripNode
    expect(back.data.demo?.note).toContain('</script>')
  })

  test('HTML 注释序列同样被转义', () => {
    const n = node()
    n.data = { demo: { note: '<!-- x -->' } }
    expect(serializeNode(n)).not.toContain('<')
  })
})

describe('parseNodeJson:校验 + 原样持有', () => {
  test('损坏 JSON → corrupted', () => {
    const r = parseNodeJson('{invalid')
    expect(r.ok).toBe(false)
  })

  test.each(['"字符串"', '123', 'null', '[]'])('非对象 %s → corrupted', (input) => {
    expect(parseNodeJson(input).ok).toBe(false)
  })

  test('schemaVersion 缺失/小数/负数/零 → corrupted', () => {
    expect(parseNodeJson('{"schemaVersion":"1"}').ok).toBe(false)
    expect(parseNodeJson('{"schemaVersion":1.5}').ok).toBe(false)
    expect(parseNodeJson('{"schemaVersion":-1}').ok).toBe(false)
    expect(parseNodeJson('{"schemaVersion":0}').ok).toBe(false)
  })

  test('project.id 缺失/空 → corrupted', () => {
    expect(parseNodeJson('{"schemaVersion":1}').ok).toBe(false)
    expect(parseNodeJson('{"schemaVersion":1,"project":{}}').ok).toBe(false)
    expect(parseNodeJson('{"schemaVersion":1,"project":{"id":""}}').ok).toBe(false)
  })

  test('未知顶层字段与 project 附加字段原样保留(不投影)', () => {
    const raw = {
      schemaVersion: 1,
      format: 'tripscope',
      project: { id: 'p1', name: 'X', extra: { nested: true } },
      updatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
      data: {},
      futureField: { a: [1, 2, { k: 'v' }] },
    }
    const r = parseNodeJson(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((r.node as Record<string, unknown>).futureField).toEqual(raw.futureField)
    expect((r.node.project as Record<string, unknown>).extra).toEqual(raw.project.extra)
  })

  test('缺失必需字段补默认值', () => {
    const r = parseNodeJson('{"schemaVersion":1,"project":{"id":"p1"}}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.node.project.name).toBe('未命名旅行')
    expect(typeof r.node.updatedAt).toBe('string')
    expect(r.node.appVersion).toBe('')
    expect(r.node.data).toEqual({})
  })

  test('v99 高版本文件导出往返不丢字段(只读承诺的根基)', () => {
    const raw = {
      format: 'tripscope',
      schemaVersion: 99,
      project: { id: 'future-1', name: '未来文件', reviewer: '妈妈' },
      updatedAt: '2026-11-06T00:00:00.000Z',
      appVersion: '9.9.9',
      data: { demo: { note: 'x' } },
      budgetV99: { totalCents: 123456 },
    }
    const first = parseNodeJson(JSON.stringify(raw))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = parseNodeJson(serializeNode(first.node))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(canonicalJson(second.node)).toBe(canonicalJson(raw))
  })
})

describe('findDataNode / replaceDataNode:严格边界', () => {
  const good = JSON.stringify({ schemaVersion: 1, project: { id: 'p1', name: 'N' } })

  test('唯一命中,开标签原文保留', () => {
    const r = findDataNode(page(good))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.openTag).toBe('<script id="app-data" type="application/json">')
      expect(() => JSON.parse(r.json)).not.toThrow()
    }
  })

  test('多节点拒绝且原因为 multiple', () => {
    const r = findDataNode(page(good) + page(good))
    expect(!r.ok && r.reason === 'multiple').toBe(true)
  })

  test('严格形态 + 宽容形态并存 → multiple(统一统计,不漏检)', () => {
    const html = page(good) + page(good, `<script TYPE='Application/JSON' id='app-data'>`)
    const r = findDataNode(html)
    expect(!r.ok && r.reason === 'multiple').toBe(true)
  })

  test('缺失拒绝且原因为 missing', () => {
    const r = findDataNode('<html><body>没有节点</body></html>')
    expect(!r.ok && r.reason === 'missing').toBe(true)
  })

  test('属性顺序/大小写变体走宽容版,开标签原文保留', () => {
    const open = `<script TYPE='Application/JSON' id='app-data' data-x='1'>`
    const r = findDataNode(page(good, open))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.openTag).toBe(open)
  })

  test('BOM 前缀不影响命中', () => {
    expect(findDataNode('\uFEFF' + page(good)).ok).toBe(true)
  })

  test('CRLF 行尾文件不受影响', () => {
    expect(findDataNode(page(good).replace(/\n/g, '\r\n')).ok).toBe(true)
  })

  test('替换:开标签保留、数据段无裸 <、解析后内容还原', () => {
    const next = node()
    next.data = { demo: { note: '</script>危险' } }
    const r = replaceDataNode(page(good), next)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const found = findDataNode(r.html)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.json).not.toContain('<')
      const parsed = JSON.parse(found.json) as TripNode
      expect(parsed.data.demo?.note).toContain('</script>')
    }
  })

  test('missing/multiple 时拒绝替换', () => {
    expect(replaceDataNode('<html></html>', node()).ok).toBe(false)
    expect(replaceDataNode(page(good) + page(good), node()).ok).toBe(false)
  })
})

describe('canonicalJson / nodeContentSignature', () => {
  test('键序无关(含嵌套)', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
    expect(canonicalJson({ a: { x: 1, y: [1, 2] } })).toBe(canonicalJson({ a: { y: [1, 2], x: 1 } }))
  })

  test('数组有序', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  test('签名只含项目名与数据,时间戳不参与', () => {
    const a = node({ updatedAt: '2026-01-01T00:00:00.000Z' })
    const b = node({ updatedAt: '2030-12-31T00:00:00.000Z' })
    expect(nodeContentSignature(a)).toBe(nodeContentSignature(b))
    b.project.name = '改名'
    expect(nodeContentSignature(a)).not.toBe(nodeContentSignature(b))
  })
})

describe('sanitizeFileName', () => {
  test('非法字符替换为下划线', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  test('尾随点与空格剥离(Windows 危险名)', () => {
    expect(sanitizeFileName('trip...')).toBe('trip')
    expect(sanitizeFileName('trip  ')).toBe('trip')
  })

  test('Windows 保留名加前缀', () => {
    expect(sanitizeFileName('con')).toBe('_con')
    expect(sanitizeFileName('COM1.txt')).toMatch(/^_COM1/)
  })

  test('空白名回退 trip', () => {
    expect(sanitizeFileName('   ')).toBe('trip')
  })

  test('超长截断到 60', () => {
    expect(sanitizeFileName('旅'.repeat(80)).length).toBeLessThanOrEqual(60)
  })
})

describe('validateSnapshotHtml', () => {
  const MARK = '/*! tripscope-app */'

  test('合法单文件通过', () => {
    const html =
      `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
      `<script id="app-data" type="application/json">{}</script>` +
      `<script>${MARK}</script></body></html>`
    const v = validateSnapshotHtml(html, MARK)
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
  })

  test('非内联 link 记为问题', () => {
    const html =
      `<!DOCTYPE html><html><head><style>a{}</style>` +
      `<link rel="stylesheet" href="main.css"></head><body>` +
      `<script id="app-data" type="application/json">{}</script>` +
      `<script>${MARK}</script></body></html>`
    const v = validateSnapshotHtml(html, MARK)
    expect(!v.ok && v.issues.some((i) => i.includes('link'))).toBe(true)
  })

  test('缺少内联样式记为问题', () => {
    const html =
      `<!DOCTYPE html><html><head></head><body>` +
      `<script id="app-data" type="application/json">{}</script>` +
      `<script>${MARK}</script></body></html>`
    expect(!validateSnapshotHtml(html, MARK).ok).toBe(true)
  })

  test('缺少主应用脚本标记记为问题', () => {
    const html =
      `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
      `<script id="app-data" type="application/json">{}</script></body></html>`
    expect(!validateSnapshotHtml(html, MARK).ok).toBe(true)
  })

  test('数据节点缺失记为问题', () => {
    const html = `<!DOCTYPE html><html><head><style>a{}</style></head><body><script>${MARK}</script></body></html>`
    expect(!validateSnapshotHtml(html, MARK).ok).toBe(true)
  })

  test('闭合的外链 script 被识别(先剔块再查会漏)', () => {
    const html =
      `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
      `<script id="app-data" type="application/json">{}</script>` +
      `<script>${MARK}</script>` +
      `<script src="https://cdn.example.com/x.js"></script></body></html>`
    const v = validateSnapshotHtml(html, MARK)
    expect(!v.ok && v.issues.some((i) => i.includes('外链'))).toBe(true)
  })
})
