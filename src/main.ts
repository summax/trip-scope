import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import { run } from './core/bootstrap'
import { surfaceError } from './core/store'

run()
const app = createApp(App)
// 生产版 Vue 会静默吞掉异步事件处理器中的异常,这里给出可见反馈
app.config.errorHandler = (err) => {
  console.error(err)
  surfaceError(err)
}
app.mount('#app')
