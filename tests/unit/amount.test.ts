import { describe, expect, test } from 'vitest'
import {
  AMOUNT_REASON_TEXT,
  MAX_AMOUNT_CENTS,
  formatCents,
  parseAmount,
} from '../../src/core/amount'

describe('parseAmount:接受矩阵', () => {
  test.each([
    ['0', 0],
    ['008', 800],
    ['1280', 128000],
    [' 42 ', 4200],
    ['0.99', 99],
    ['12.00', 1200],
    ['1,280.5', 128050],
    ['1 280', 128000],
    ['1_000', 100000],
    ['１２８０.５', 128050], // 全角归一化
  ])('%s → %i 分', (input, cents) => {
    const r = parseAmount(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.cents).toBe(cents)
  })
})

describe('parseAmount:拒绝矩阵(拒绝是一等公民)', () => {
  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [',, ,', 'empty'],
    ['abc', 'invalid-chars'],
    ['¥100', 'invalid-chars'],
    ['1e5', 'invalid-chars'],
    ['12.3.4', 'invalid-chars'],
    ['-5', 'negative'],
    ['- 0', 'negative'],
    ['+5', 'sign'],
    ['1.234', 'decimals'],
    ['.5', 'no-integer-part'],
    ['12.', 'trailing-point'],
    ['1000000000000.01', 'overflow'], // 10^12 元 + 1分
  ])('%s → %s', (input, reason) => {
    const r = parseAmount(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe(reason)
      expect(AMOUNT_REASON_TEXT[r.reason].length).toBeGreaterThan(0)
    }
  })
})

describe('parseAmount:边界', () => {
  test('上限 10^12 元恰好可收,超出 1 分拒绝', () => {
    expect(parseAmount('1000000000000').ok).toBe(true) // 1e12 元
    expect(parseAmount('999999999999.99').ok).toBe(true)
  })

  test('formatCents 千分位两位小数,负数防御', () => {
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(99)).toBe('0.99')
    expect(formatCents(128050)).toBe('1,280.50')
    expect(formatCents(100000000)).toBe('1,000,000.00')
    expect(formatCents(-5)).toBe('-0.05')
  })

  test('parseAmount(formatCents(x)) 往返一致', () => {
    for (const cents of [0, 99, 128050, 123456789]) {
      expect(parseAmount(formatCents(cents))).toEqual({ ok: true, cents })
    }
  })

  test('MAX_AMOUNT_CENTS = 10^14', () => {
    expect(MAX_AMOUNT_CENTS).toBe(1e14)
  })
})
