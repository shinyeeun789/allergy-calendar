<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { signOut } from 'firebase/auth'
import { auth } from '@/firebase'
import { useAuthStore } from '@/stores/auth'

// ── Props / Emits ──────────────────────────────────────────
export interface NavTab {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  tabs?:      NavTab[]
  activeTab?: string
}>(), {
  tabs:      () => [],
  activeTab: '',
})

const emit = defineEmits<{
  'update:activeTab': [value: string]
  'tab-click':        [key: string]
}>()

// ── Auth ───────────────────────────────────────────────────
const router    = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.user)

const userName = computed(() => {
  const u = user.value
  if (!u) return '사용자'
  return u.displayName || u.email?.split('@')[0] || '사용자'
})

const userInitial = computed(() => userName.value.charAt(0).toUpperCase())

async function handleLogout() {
  await signOut(auth)
  router.push('/login')
}

// ── Handlers ───────────────────────────────────────────────
function onTabClick(key: string) {
  emit('update:activeTab', key)
  emit('tab-click', key)
}
</script>

<template>
  <nav>
    <div class="nav-inner">
      <!-- 로고 -->
      <a class="nav-logo" href="/" @click.prevent="router.push('/')">
        <span class="logo-badge">A</span>
        <span class="logo-wordmark">Check</span>
      </a>

      <!-- 탭 -->
      <div v-if="tabs.length" class="nav-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="nav-tab"
          :class="{ active: activeTab === tab.key }"
          type="button"
          @click="onTabClick(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 유저 영역 -->
      <div class="nav-user">
        <div class="user-chip">
          <div class="user-avatar">
            <img
              v-if="user?.photoURL"
              :src="user.photoURL"
              :alt="userName"
              style="display:block"
            >
            <span v-else>{{ userInitial }}</span>
          </div>
          <span class="user-chip-name">{{ userName }}</span>
        </div>
        <button class="btn-logout-sm" type="button" @click="handleLogout">
          로그아웃
        </button>
      </div>
    </div>
  </nav>
</template>
