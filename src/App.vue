<script setup lang="ts">
import { watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router    = useRouter()
const route     = useRoute()
const authStore = useAuthStore()

// 외부 이벤트(토큰 만료 등)로 로그아웃됐을 때 보호 경로에서 내보내기
watch(() => authStore.user, (user) => {
  if (!user && route.meta.requiresAuth) {
    router.push('/login')
  }
})
</script>

<template>
  <RouterView />
</template>
