import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import { run } from './core/bootstrap'

run()
createApp(App).mount('#app')
