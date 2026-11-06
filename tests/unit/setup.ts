/**
 * Node 环境存根:store 层草稿链路测试需要 window.localStorage。
 * 存根实例挂到 globalThis.__tsStorage,测试可注入写失败模拟配额满/隐私模式。
 */
class MemoryStorage implements Storage {
  failWrites = false
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null
  }
  clear(): void {
    this.map.clear()
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError:模拟配额满')
    this.map.set(k, String(v))
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  has(k: string): boolean {
    return this.map.has(k)
  }
}

const __tsStorage = new MemoryStorage()
;(globalThis as any).window = (globalThis as any).window ?? {}
;(globalThis as any).window.localStorage = __tsStorage
;(globalThis as any).__tsStorage = __tsStorage
