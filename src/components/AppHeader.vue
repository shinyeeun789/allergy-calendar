<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
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
  pageTitle?: string
}>(), {
  tabs:      () => [],
  activeTab: '',
  pageTitle: '',
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

// ── User Menu Dropdown ─────────────────────────────────────
const menuWrapRef   = ref<HTMLElement | null>(null)
const showUserMenu  = ref(false)

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
}

function closeUserMenu() {
  showUserMenu.value = false
}

function goMyPage() {
  closeUserMenu()
  router.push('/my-page')
}

function onClickOutside(e: MouseEvent) {
  if (menuWrapRef.value && !menuWrapRef.value.contains(e.target as Node)) {
    closeUserMenu()
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))

// ── Tab Handlers ───────────────────────────────────────────
function onTabClick(key: string) {
  emit('update:activeTab', key)
  emit('tab-click', key)
}
</script>

<template>
  <nav>
    <div class="nav-inner">

      <!-- ── 왼쪽: 로고 [+ 서브페이지 타이틀] ── -->
      <div class="nav-left">
        <a class="nav-logo" href="/" @click.prevent="router.push('/')">
          <span class="logo-badge">A</span>
          <span class="logo-wordmark">Check</span>
        </a>

        <!-- 서브페이지일 때: 구분선 + 페이지 타이틀 -->
        <template v-if="pageTitle">
          <span class="nav-title-sep" aria-hidden="true"></span>
          <span class="nav-page-title">{{ pageTitle }}</span>
        </template>
      </div>

      <!-- ── 중앙: 탭 (메인 페이지) ── -->
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

      <!-- ── 오른쪽: 유저 ── -->
      <div class="nav-user">
        <!-- 유저 칩 + 드롭다운 -->
        <div class="nav-user-menu-wrap" ref="menuWrapRef">
          <button
            class="user-chip"
            :class="{ open: showUserMenu }"
            type="button"
            aria-haspopup="true"
            :aria-expanded="showUserMenu"
            @click="toggleUserMenu"
          >
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
            <!-- 쉐브론 -->
            <svg
              class="user-chip-chevron"
              :class="{ rotated: showUserMenu }"
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              aria-hidden="true"
            >
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- 드롭다운 패널 -->
          <Transition name="user-menu">
            <div v-if="showUserMenu" class="nav-user-menu" role="menu">
              <!-- 유저 정보 헤더 -->
              <div class="nav-user-menu-header">
                <div class="nav-user-menu-avatar">
                  <img v-if="user?.photoURL" :src="user.photoURL" :alt="userName" style="display:block; width:100%; height:100%; object-fit:cover;">
                  <span v-else>{{ userInitial }}</span>
                </div>
                <div class="nav-user-menu-info">
                  <span class="nav-user-menu-name">{{ userName }}</span>
                  <span class="nav-user-menu-email">{{ user?.email }}</span>
                </div>
              </div>

              <div class="nav-user-menu-divider"></div>

              <!-- 메뉴 아이템 -->
              <button class="nav-user-menu-item" type="button" role="menuitem" @click="goMyPage">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="5.5" r="2.8" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M2.5 14c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                마이페이지
              </button>

              <div class="nav-user-menu-divider"></div>

              <button class="nav-user-menu-item logout" type="button" role="menuitem" @click="() => { closeUserMenu(); handleLogout() }">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <path d="M10.5 11L14 8l-3.5-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M14 8H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                로그아웃
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </nav>
</template>
