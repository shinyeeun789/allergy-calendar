<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  collection, doc, addDoc, getDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'

// ── 공통 타입 ─────────────────────────────────────────────────
type MedType = 'PILL' | 'OINTMENT' | 'NASAL_SPRAY' | 'EYE_DROP' | 'SYRUP'

interface MedTypeOption { value: MedType; emoji: string; label: string }

const MED_TYPES: MedTypeOption[] = [
  { value: 'PILL',        emoji: '💊', label: '알약/캡슐' },
  { value: 'OINTMENT',    emoji: '🧴', label: '바르는 연고' },
  { value: 'NASAL_SPRAY', emoji: '👃', label: '코 스프레이' },
  { value: 'EYE_DROP',    emoji: '💧', label: '눈 안약' },
  { value: 'SYRUP',       emoji: '🥤', label: '물약/시럽' },
]

// ── 설정 ──────────────────────────────────────────────────────
const router    = useRouter()
const route     = useRoute()
const authStore = useAuthStore()

// ── 수정 모드 ─────────────────────────────────────────────────
const editId     = ref<string | null>(null)
const isEditMode = computed(() => !!editId.value)
const heroTitle  = computed(() => isEditMode.value ? '약 정보 수정' : '새 약 등록')
const navTitle   = computed(() => isEditMode.value ? '약 정보 수정' : '새 약 등록')
const heroSub    = computed(() => isEditMode.value ? '등록된 약 정보를 수정합니다' : '처방받은 약이나 상비약을 등록해두세요')
const btnLabel   = computed(() => isEditMode.value ? '수정 완료' : '등록 완료')
const isLoading  = ref(false)

// ── 폼 상태 ──────────────────────────────────────────────────
const selectedType  = ref<MedType | null>(null)
const nickname      = ref('')
const isSubmitting  = ref(false)
const submitError   = ref('')
const typeError     = ref(false)
const nicknameError = ref(false)

// ── 수정 모드: 기존 데이터 로드 ───────────────────────────────
async function loadEditData(id: string) {
  const uid = authStore.user?.uid
  if (!uid) return
  isLoading.value = true
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'medications', id))
    if (!snap.exists()) { router.replace('/my-page'); return }
    const data = snap.data()
    selectedType.value = data.type as MedType
    nickname.value     = data.nickname as string
  } catch (e) {
    console.error('[medicationRegister] 로드 오류:', e)
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  const id = route.query.id
  if (typeof id === 'string' && id) {
    editId.value = id
    loadEditData(id)
  }
})

// ── 유효성 검사 ───────────────────────────────────────────────
function validate(): boolean {
  typeError.value     = !selectedType.value
  nicknameError.value = !nickname.value.trim()
  return !typeError.value && !nicknameError.value
}

// ── 제출 ──────────────────────────────────────────────────────
async function handleSubmit() {
  if (!validate()) return
  isSubmitting.value = true
  submitError.value  = ''

  try {
    const uid = authStore.user!.uid

    const payload = {
      type:     selectedType.value,
      nickname: nickname.value.trim(),
    }

    if (isEditMode.value) {
      // 수정 모드: updateDoc
      await updateDoc(doc(db, 'users', uid, 'medications', editId.value!), {
        ...payload,
        updatedAt: serverTimestamp(),
      })
    } else {
      // 신규 등록: addDoc
      await addDoc(collection(db, 'users', uid, 'medications'), {
        ...payload,
        createdAt: serverTimestamp(),
      })
    }

    router.push('/my-page')
  } catch (e) {
    console.error('[medicationRegister] 저장 오류:', e)
    submitError.value = '저장 중 오류가 발생했습니다. 다시 시도해주세요.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <AppHeader :pageTitle="navTitle" />

  <div class="page-body med-page">

    <!-- ── 히어로 헤더 ── -->
    <div class="med-hero">
      <button class="btn-back" type="button" aria-label="뒤로가기" @click="router.back()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="med-hero-body">
        <span class="med-hero-badge">💊 내 약 상자</span>
        <h1 class="med-hero-title">{{ heroTitle }}</h1>
        <p class="med-hero-sub">{{ heroSub }}</p>
      </div>
      <div class="med-hero-deco" aria-hidden="true"></div>
    </div>

    <!-- 로딩 스켈레톤 -->
    <div v-if="isLoading" class="med-skeleton-wrap">
      <div class="med-skeleton-block tall"></div>
      <div class="med-skeleton-block"></div>
      <div class="med-skeleton-block short"></div>
    </div>

    <!-- ── 폼 ── -->
    <form v-else class="med-form" @submit.prevent="handleSubmit" novalidate>

      <!-- ① 약 종류 선택 -->
      <div class="diet-section" :class="{ 'med-section-error': typeError }">
        <p class="diet-section-label">
          <span class="diet-section-dot"></span>
          약 종류
          <span class="med-required-badge">필수</span>
        </p>

        <div class="med-type-grid">
          <button
            v-for="t in MED_TYPES"
            :key="t.value"
            type="button"
            class="med-type-btn"
            :class="{ active: selectedType === t.value }"
            @click="selectedType = t.value; typeError = false"
          >
            <span class="med-type-emoji" aria-hidden="true">{{ t.emoji }}</span>
            <span class="med-type-label">{{ t.label }}</span>
            <span v-if="selectedType === t.value" class="med-type-check" aria-hidden="true">
              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                <path d="M1 3l2 2 4-4" stroke="#fff" stroke-width="1.6"
                      stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>
        </div>

        <p v-if="typeError" class="med-field-error">약 종류를 선택해주세요</p>
      </div>

      <!-- ② 나만의 약 닉네임 -->
      <div class="diet-section" :class="{ 'med-section-error': nicknameError }">
        <p class="diet-section-label">
          <span class="diet-section-dot"></span>
          나만의 약 닉네임
          <span class="med-required-badge">필수</span>
        </p>

        <input
          v-model="nickname"
          class="med-nickname-input"
          :class="{ error: nicknameError }"
          type="text"
          maxlength="40"
          placeholder="예) 아침 비염약, 피부 가려울 때 연고, 약국 상비약"
          @input="nicknameError = false"
        />
        <div class="med-nickname-footer">
          <p v-if="nicknameError" class="med-field-error">약 닉네임을 입력해주세요</p>
          <span v-else></span>
          <span class="med-char-count">{{ nickname.length }}<span class="med-char-max">/40</span></span>
        </div>
      </div>

      <!-- 에러 메시지 -->
      <div v-if="submitError" class="med-submit-error" role="alert">
        <span class="med-submit-error-icon" aria-hidden="true">!</span>
        {{ submitError }}
      </div>

      <!-- ④ 등록/수정 완료 버튼 -->
      <div class="diet-submit-wrap">
        <button type="submit" class="diet-submit-btn" :disabled="isSubmitting">
          <template v-if="isSubmitting">
            <span class="diet-submit-spinner"></span>
            {{ isEditMode ? '수정 중...' : '등록 중...' }}
          </template>
          <template v-else>
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <path d="M2 9.5l4.5 4L15 4" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {{ btnLabel }}
          </template>
        </button>
      </div>

    </form>
  </div>
</template>
