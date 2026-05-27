<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { collection, query, orderBy, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'

// ── 타입 ──────────────────────────────────────────────────────
type MedType = 'PILL' | 'OINTMENT' | 'NASAL_SPRAY' | 'EYE_DROP' | 'SYRUP'

interface Medication {
  id:        string
  type:      MedType
  nickname:  string
  createdAt: any
}

const MED_TYPE_INFO: Record<MedType, { emoji: string; label: string }> = {
  PILL:        { emoji: '💊', label: '알약/캡슐' },
  OINTMENT:    { emoji: '🧴', label: '바르는 연고' },
  NASAL_SPRAY: { emoji: '👃', label: '코 스프레이' },
  EYE_DROP:    { emoji: '👁️', label: '눈 안약' },
  SYRUP:       { emoji: '🥤', label: '물약/시럽' },
}

// ── 설정 ──────────────────────────────────────────────────────
const router    = useRouter()
const authStore = useAuthStore()

// ── 유저 ──────────────────────────────────────────────────────
const user = computed(() => authStore.user)
const userName = computed(() => {
  const u = user.value
  if (!u) return '사용자'
  return u.displayName || u.email?.split('@')[0] || '사용자'
})
const userEmail   = computed(() => user.value?.email ?? '')
const userInitial = computed(() => userName.value.charAt(0).toUpperCase())

// ── 약 목록 ───────────────────────────────────────────────────
const medications = ref<Medication[]>([])
const isLoading   = ref(true)
const fetchError  = ref('')

async function fetchMedications() {
  const uid = authStore.user?.uid
  if (!uid) return
  isLoading.value  = true
  fetchError.value = ''
  try {
    const q    = query(
      collection(db, 'users', uid, 'medications'),
      orderBy('createdAt', 'desc'),
    )
    const snap = await getDocs(q)
    medications.value = snap.docs.map(d => {
      const data = d.data()
      return {
        id:        d.id,
        type:      (data.type ?? 'PILL') as MedType,
        nickname:  data.nickname as string,
        createdAt: data.createdAt,
      }
    })
  } catch (e) {
    console.error('[myPage] fetch error:', e)
    fetchError.value = '목록을 불러오지 못했습니다. 다시 시도해주세요.'
  } finally {
    isLoading.value = false
  }
}

// ── 삭제 ──────────────────────────────────────────────────────
const deletingId  = ref<string | null>(null)
const isDeleting  = ref(false)
const deleteError = ref('')
const deletingNickname = computed(
  () => medications.value.find(m => m.id === deletingId.value)?.nickname ?? ''
)

function confirmDelete(id: string) { deletingId.value = id; deleteError.value = '' }
function cancelDelete()            { deletingId.value = null }

async function handleDelete() {
  const uid = authStore.user?.uid
  if (!uid || !deletingId.value) return
  isDeleting.value  = true
  deleteError.value = ''
  try {
    // Firestore 문서 삭제
    await deleteDoc(doc(db, 'users', uid, 'medications', deletingId.value))
    medications.value = medications.value.filter(m => m.id !== deletingId.value)
    deletingId.value  = null
  } catch (e) {
    console.error('[myPage] delete error:', e)
    deleteError.value = '삭제 중 오류가 발생했습니다.'
  } finally {
    isDeleting.value = false
  }
}

// ── 키보드 단축키 ─────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (deletingId.value && e.key === 'Escape') cancelDelete()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  fetchMedications()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <AppHeader pageTitle="마이페이지" />

  <div class="page-body myp-page">

    <!-- ── 프로필 카드 ── -->
    <div class="myp-profile-card">
      <!-- 아바타 -->
      <div class="myp-avatar-wrap">
        <div class="myp-avatar">
          <img v-if="user?.photoURL" :src="user.photoURL" :alt="userName" />
          <span v-else>{{ userInitial }}</span>
        </div>
      </div>
      <!-- 정보 -->
      <div class="myp-profile-info">
        <p class="myp-profile-name">{{ userName }}님</p>
        <p class="myp-profile-email">{{ userEmail }}</p>
      </div>
      <!-- 편집 버튼 (우측 뱃지) -->
      <div class="myp-profile-badge">마이페이지</div>
    </div>

    <!-- ── 내 약 상자 섹션 ── -->
    <div class="myp-section">

      <!-- 섹션 헤더 -->
      <div class="myp-section-header">
        <div class="myp-section-title-wrap">
          <span aria-hidden="true">💊</span>
          <h2 class="myp-section-title">내 약 상자</h2>
          <span v-if="!isLoading" class="myp-section-count">{{ medications.length }}</span>
        </div>
        <button class="myp-btn-add" type="button" @click="router.push('/medication-register')">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          새 약 등록
        </button>
      </div>

      <!-- 로딩 -->
      <div v-if="isLoading" class="myp-loading">
        <div class="myp-loading-spinner"></div>
        <span>불러오는 중...</span>
      </div>

      <!-- 에러 -->
      <div v-else-if="fetchError" class="myp-fetch-error">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="#e53e3e" stroke-width="1.4"/>
          <path d="M8 5v4M8 10.5v.5" stroke="#e53e3e" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        {{ fetchError }}
      </div>

      <!-- 빈 상태 -->
      <div v-else-if="!medications.length" class="myp-empty">
        <div class="myp-empty-icon-wrap">
          <span class="myp-empty-icon">💊</span>
        </div>
        <p class="myp-empty-title">약 상자가 비어있어요</p>
        <p class="myp-empty-desc">처방받은 약이나 상비약을<br>지금 등록해보세요</p>
        <button class="myp-empty-btn" type="button" @click="router.push('/medication-register')">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          첫 번째 약 등록하기
        </button>
      </div>

      <!-- ── 약 카드 목록 ── -->
      <div v-else class="myp-med-list">
        <div
          v-for="med in medications"
          :key="med.id"
          class="myp-med-card"
        >
          <!-- 왼쪽: 타입 아이콘 -->
          <div class="myp-med-icon-wrap">
            <span class="myp-med-emoji" aria-hidden="true">
              {{ MED_TYPE_INFO[med.type]?.emoji ?? '💊' }}
            </span>
          </div>

          <!-- 중앙: 닉네임 + 타입명 -->
          <div class="myp-med-body">
            <p class="myp-med-nickname">{{ med.nickname }}</p>
            <p class="myp-med-type-label">{{ MED_TYPE_INFO[med.type]?.label }}</p>
          </div>

          <!-- 우측 영역 (클릭 전파 차단) -->
          <div class="myp-med-right" @click.stop @keydown.stop>

            <!-- 수정 / 삭제 버튼 -->
            <div class="myp-med-actions">
              <button
                type="button"
                class="myp-med-action-btn edit"
                aria-label="수정"
                @click="router.push(`/medication-register?id=${med.id}`)"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M9.5 2.5l2 2L4 13H2v-2L9.5 2.5Z" stroke="currentColor"
                        stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                수정
              </button>
              <button
                type="button"
                class="myp-med-action-btn delete"
                aria-label="삭제"
                @click="confirmDelete(med.id)"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 3.5h10M5 3.5V2h4v1.5M11.5 3.5L11 12a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 3 12L2.5 3.5"
                        stroke="currentColor" stroke-width="1.3" stroke-linecap="round"
                        stroke-linejoin="round"/>
                </svg>
                삭제
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ 삭제 확인 다이얼로그 ══ -->
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="deletingId"
        class="rd-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="삭제 확인"
        @click.self="cancelDelete"
      >
        <div class="myp-delete-sheet">
          <div class="rd-handle"></div>
          <div class="myp-delete-icon-wrap" aria-hidden="true">🗑️</div>
          <h3 class="myp-delete-title">정말 삭제할까요?</h3>
          <p class="myp-delete-desc">
            <strong>{{ deletingNickname }}</strong>이(가)<br>
            영구적으로 삭제됩니다.
          </p>
          <p v-if="deleteError" class="myp-delete-error" role="alert">{{ deleteError }}</p>
          <div class="myp-delete-actions">
            <button
              class="myp-delete-cancel"
              type="button"
              :disabled="isDeleting"
              @click="cancelDelete"
            >취소</button>
            <button
              class="myp-delete-confirm"
              type="button"
              :disabled="isDeleting"
              @click="handleDelete"
            >
              <template v-if="isDeleting">
                <span class="myp-delete-spinner"></span>삭제 중...
              </template>
              <template v-else>삭제</template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

</template>
