import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/dark/css-vars.css'
import router from './router'
import App from './App.vue'
import { useThemeStore } from './stores/theme'
import './styles/global.scss'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
useThemeStore(pinia).init()
app.use(router)
app.mount('#app')
