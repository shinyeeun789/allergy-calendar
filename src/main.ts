import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import './assets/common.css'

const app   = createApp(App)
const pinia = createPinia()

app.use(pinia)

// Firebase auth 상태가 확정된 뒤 라우터를 설치해야
// app.use(router)가 유발하는 초기 네비게이션 시점에
// beforeEach 가드가 올바른 인증 상태를 읽을 수 있다.
const authStore = useAuthStore()
authStore.init().then(() => {
  app.use(router)
  app.mount('#app')
})
