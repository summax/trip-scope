/**
 * 金额解析:用户输入文本 → 整数分。
 * 拒绝是一等公民:不精确、越界、含杂质的输入一律给原因码,绝不静默取整。
 * 约束来源:docs/requirements-2026-11-06.md I3(整数分);
 * I8 的「金额可 null=未定价」由 UI 层表达,解析器只收文本。
 */

/** 上限 10^12 元 = 10^14 分,防溢出与荒诞值 */
export const MAX_AMOUNT_CENTS = 1e14

export type AmountReason =
  | 'empty'
  | 'invalid-chars'
  | 'negative'
  | 'sign'
  | 'decimals'
  | 'no-integer-part'
  | 'trailing-point'
  | 'overflow'

export const AMOUNT_REASON_TEXT: Record<AmountReason, string> = {
  empty: '请输入金额',
  'invalid-chars': '金额只能包含数字、最多两位小数与分隔符',
  negative: '金额不能为负数',
  sign: '金额不需要正负号',
  decimals: '金额最多两位小数(以分存储)',
  'no-integer-part': '小数点前必须有整数部分',
  'trailing-point': '小数点后必须有数字',
  overflow: '金额超出上限(1 万亿元)',
}

export type ParseAmountResult =
  | { ok: true; cents: number }
  | { ok: false; reason: AmountReason }

export function parseAmount(input: string): ParseAmountResult {
  // 全角数字/句点/逗号归一化为半角
  let s = input
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\uFF0E/g, '.')
    .replace(/\uFF0C/g, ',')
  s = s.trim()
  if (s === '') return { ok: false, reason: 'empty' }
  if (s.startsWith('-')) return { ok: false, reason: 'negative' }
  if (s.startsWith('+')) return { ok: false, reason: 'sign' }
  // 千分位逗号/空白/下划线一律视作分隔符
  s = s.replace(/[\s,_]/g, '')
  if (s === '') return { ok: false, reason: 'empty' }
  if (!/^[0-9.]+$/.test(s)) return { ok: false, reason: 'invalid-chars' }
  if (!/^\d/.test(s)) return { ok: false, reason: 'no-integer-part' }
  if (s.endsWith('.')) return { ok: false, reason: 'trailing-point' }
  const dot = s.indexOf('.')
  let cents: number
  if (dot === -1) {
    cents = Number(s) * 100
  } else {
    if (s.indexOf('.', dot + 1) !== -1) return { ok: false, reason: 'invalid-chars' }
    const dec = s.slice(dot + 1)
    if (dec.length > 2) return { ok: false, reason: 'decimals' }
    cents = Number(s.slice(0, dot)) * 100 + Number(dec.padEnd(2, '0'))
  }
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'overflow' }
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, reason: 'overflow' }
  return { ok: true, cents }
}

/** 分 → 千分位 + 两位小数(如 128050 → "1,280.50");负数防御性保留负号 */
export function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(Math.trunc(cents))
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const dec = String(abs % 100).padStart(2, '0')
  return (neg ? '-' : '') + int + '.' + dec
}
