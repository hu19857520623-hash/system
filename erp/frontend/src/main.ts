import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/theme-chalk/dark/css-vars.css'
// 模板里自动引入的组件会带样式；JS 里调用的 MessageBox / Message / Loading 等不会，
// 缺 overlay 时弹层会变成页面底部的普通块，看起来像互相覆盖、点不开。
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-drawer.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-notification.css'
import 'element-plus/theme-chalk/el-loading.css'
import 'element-plus/theme-chalk/el-popper.css'
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
