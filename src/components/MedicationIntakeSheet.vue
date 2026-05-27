<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { collection, getDocs, addDoc, query, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuthStore } from '@/stores/auth'

// ── 타입 ──────────────────────────────────────────────────────
type MedType = 'PILL' | 'OINTMENT' | 'NASAL_SPRAY' | 'EYE_DROP' | 'SYRUP'

interface Medication {
  id:       string
  type:     MedType
  nickname: string
}

const MED_TYPE_EMOJI: Record<MedType, string> = {
  PILL:        '💊',
  OINTMENT:    '🧴',
  NASAL_SPRAY: '👃',
  EYE_DROP:    '👁️',
  SYRUP:       '🥤',
}

// ── Props / Emits ──────────────────────────────────────────────
const props = withDefaults(defineProps<{
  visible:          boolean
  /** 알러지 기록과 연동할 때 전달 */
  allergyRecordId?: string | null
  /** 알러지 발생 시각 (연동 표시용) */
  allergyDate?:     Date | null
}>(), {
  allergyRecordId: null,
  allergyDate:     null,
})

const emit = defineEmits<{
  close: []
  saved: []
}>()

// ── 상태 ──────────────────────────────────────────────────────
const router    = useRouter()
const authStore = useAuthStore()

const medications  = ref<Medication[]>([])
const selectedIds  = ref<Set<string>>(new Set())
const isLoading    = ref(false)
const isSaving     = ref(false)
const errorMsg     = ref('')
const success      = ref(false)

// ── 시간 입력 ─────────────────────────────────────────────────
type TimeMode = 'now' | 'minus30' | 'minus60' | 'custom'
const takenTime     = ref('')
const timeMode      = ref<TimeMode>('now')
const showTimeInput = ref(false)

function fmt(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function allergyTimeLabel() {
  return props.allergyDate ? fmt(props.allergyDate) : ''
}

function setTimeNow() {
  timeMode.value      = 'now'
  showTimeInput.value = false
  takenTime.value     = fmt(new Date())
}
function setTimeMinus(minutes: number, mode: 'minus30' | 'minus60') {
  timeMode.value      = mode
  showTimeInput.value = false
  const d = new Date()
  d.setMinutes(d.getMinutes() - minutes)
  takenTime.value = fmt(d)
}
function setTimeCustom() {
  timeMode.value      = 'custom'
  showTimeInput.value = true
}

// ── 약 목록 로드 ───────────────────────────────────────────────
async function loadMedications() {
  const uid = authStore.user?.uid
  if (!uid) return
  isLoading.value = true
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'medications'), orderBy('createdAt', 'asc'))
    )
    medications.value = snap.docs.map(d => ({
      id:       d.id,
      type:     d.data().type as MedType,
      nickname: d.data().nickname as string,
    }))
  } catch (e) {
    console.error('[MedicationIntakeSheet] 로드 오류:', e)
  } finally {
    isLoading.value = false
  }
}

// ── 선택 토글 ─────────────────────────────────────────────────
function toggleMed(id: string) {
  const s = new Set(selectedIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedIds.value = s
}

// ── 저장 ──────────────────────────────────────────────────────
async function handleSave() {
  if (selectedIds.value.size === 0) {
    errorMsg.value = '복용한 약을 최소 한 가지 선택해주세요.'
    return
  }
  isSaving.value = true
  errorMsg.value = ''
  try {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('로그인 필요')

    // 복용 시각 — 오늘 날짜 + 입력 시각
    const now = new Date()
    const [h, m] = takenTime.value.split(':').map(Number)
    const takenAt = Timestamp.fromDate(
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
    )

    // 연동 알러지 시각
    const allergyAt = props.allergyDate
      ? Timestamp.fromDate(props.allergyDate)
      : null

    const selectedMeds = medications.value.filter(med => selectedIds.value.has(med.id))

    await Promise.all(
      selectedMeds.map(med =>
        addDoc(collection(db, 'users', uid, 'medicationRecords'), {
          uid,
          medicationId:       med.id,
          medicationNickname: med.nickname,
          medicationType:     med.type,
          takenAt,
          allergyRecordId:    props.allergyRecordId ?? null,
          allergyAt,
          createdAt:          serverTimestamp(),
        })
      )
    )

    success.value = true
    setTimeout(() => {
      success.value = false
      emit('saved')
      emit('close')
    }, 1600)
  } catch (e: any) {
    console.error('[MedicationIntakeSheet] 저장 오류:', e)
    errorMsg.value = '저장 중 오류가 발생했습니다. 다시 시도해주세요.'
  } finally {
    isSaving.value = false
  }
}

// ── 초기화 ────────────────────────────────────────────────────
watch(() => props.visible, (v) => {
  if (v) {
    loadMedications()
    selectedIds.value = new Set()
    setTimeNow()
    errorMsg.value = ''
    success.value  = false
  }
})

function handleClose() {
  if (!isSaving.value) emit('close')
}

function goRegister() {
  emit('close')
  router.push('/medication-register')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="rd-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="약 복용 기록"
        @click.self="handleClose"
      >
        <div class="rd-sheet mis-sheet">
          <div class="rd-handle"></div>

          <!-- 헤더 -->
          <div class="rd-header">
            <div class="rd-header-text">
              <p class="rd-eyebrow">
                <template v-if="allergyDate">
                  알러지({{ allergyTimeLabel() }})와 연동됩니다
                </template>
                <template v-else>
                  약 복용 기록
                </template>
              </p>
              <h3 class="rd-title">어떤 약을 복용하셨나요?</h3>
            </div>
            <button class="rd-close" type="button" aria-label="닫기" @click="handleClose">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- ── 성공 상태 ── -->
          <Transition name="mis-success">
            <div v-if="success" class="mis-success-state">
              <div class="mis-success-icon">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="13" fill="rgba(52,168,83,0.12)" stroke="#34A853" stroke-width="1.5"/>
                  <path d="M8 14l4 4 8-8" stroke="#34A853" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <p class="mis-success-msg">기록이 완료되었습니다.</p>
            </div>
          </Transition>

          <!-- ── 콘텐츠 ── -->
          <div v-if="!success" class="mis-body">

            <!-- 로딩 -->
            <div v-if="isLoading" class="mis-loading">
              <span class="mis-loading-spinner"></span>
              <span class="mis-loading-text">약 목록 불러오는 중…</span>
            </div>

            <!-- 빈 상태 -->
            <div v-else-if="medications.length === 0" class="mis-empty">
              <span class="mis-empty-icon">💊</span>
              <p class="mis-empty-text">등록된 약이 없습니다.<br>먼저 약을 등록해주세요.</p>
              <button class="mis-empty-btn" type="button" @click="goRegister">
                약 등록하러 가기
              </button>
            </div>

            <!-- 약 목록 -->
            <template v-else>
              <!-- 약 버튼 그리드 -->
              <div class="mis-med-list">
                <button
                  v-for="med in medications"
                  :key="med.id"
                  class="mis-med-btn"
                  :class="{ selected: selectedIds.has(med.id) }"
                  type="button"
                  @click="toggleMed(med.id)"
                >
                  <span class="mis-med-emoji">{{ MED_TYPE_EMOJI[med.type] }}</span>
                  <span class="mis-med-name">{{ med.nickname }}</span>
                  <span v-if="selectedIds.has(med.id)" class="mis-med-check" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                </button>
              </div>

              <!-- 복용 시각 -->
              <div class="mis-time-section">
                <p class="mis-time-label">복용 시각</p>

                <!-- 연동 정보 배너 -->
                <div v-if="allergyDate" class="mis-link-banner">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                  알러지 발생 시각 <strong>{{ allergyTimeLabel() }}</strong>과 함께 저장됩니다
                </div>

                <div class="time-display-row">
                  <div class="time-display">{{ takenTime }}</div>
                  <div class="time-preset-btns">
                    <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'now' }"     @click="setTimeNow">지금</button>
                    <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'minus30' }" @click="setTimeMinus(30, 'minus30')">30분 전</button>
                    <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'minus60' }" @click="setTimeMinus(60, 'minus60')">1시간 전</button>
                    <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'custom' }"  @click="setTimeCustom">직접 입력</button>
                  </div>
                </div>
                <Transition name="expand-down">
                  <div v-if="showTimeInput" class="time-input-wrap">
                    <input type="time" v-model="takenTime" class="time-input" />
                  </div>
                </Transition>
              </div>

              <!-- 에러 -->
              <Transition name="su-error-slide">
                <div v-if="errorMsg" class="su-error mis-error">
                  <span class="su-error-icon">⚠️</span>
                  {{ errorMsg }}
                </div>
              </Transition>

              <!-- 저장 버튼 -->
              <button
                class="mis-save-btn"
                type="button"
                :disabled="isSaving"
                @click="handleSave"
              >
                <span v-if="isSaving" class="diet-submit-spinner"></span>
                <template v-else>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 8.5l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  기록하기
                </template>
              </button>
            </template>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>
