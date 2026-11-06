import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import { run } from './core/bootstrap'
import { flushDraft, surfaceError } from './core/store'

run()
const app = createApp(App)
// 生产版 Vue 会静默吞掉异步事件处理器中的异常,这里给出可见反馈
app.config.errorHandler = (err) => {
  console.error(err)
  surfaceError(err)
}
// Vue 调度器之外的异步异常(定时器/裸 Promise 链)也必须有可见反馈
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason)
  surfaceError(e.reason)
})
// 同步异常走 error 事件而非 unhandledrejection;无 error/message 的是资源加载失败,忽略
window.addEventListener('error', (e) => {
  if (!e.error && !e.message) return
  console.error(e.error ?? e.message)
  surfaceError(e.error ?? e.message)
})
// 关闭/刷新前冲刷排期中的草稿,避免最后 300ms 的编辑丢失
window.addEventListener('beforeunload', () => {
  flushDraft()
})
app.mount('#app')
