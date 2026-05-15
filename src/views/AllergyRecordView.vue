<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { SKIN_SYMPTOM_CODES } from '@/constants/symptomCodes'
import { db } from '@/firebase'
import { useAuthStore } from '@/stores/auth'
import AppHeader, { type NavTab } from '@/components/AppHeader.vue'

const router = useRouter()
const route  = useRoute()
const authStore = useAuthStore()

// ── Nav ────────────────────────────────────────────────────
const NAV_TABS: NavTab[] = [
  { key: 'home',    label: '홈' },
  { key: 'records', label: '기록' },
  { key: 'stats',   label: '통계' },
]
const activeTab = ref('records')
function onTabClick(key: string) {
  if (key !== 'records') router.push('/')
}

// ── 날짜 ───────────────────────────────────────────────────
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

const dateParam = computed<string>(() => {
  const q = route.query.date
  if (typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
})

const dateParts = computed(() => {
  const [y, m, d] = dateParam.value.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return { y, m, d, dowLabel: DAY_KO[dow] + '요일' }
})

// ── 1. 증상 발생 시각 ────────────────────────────────────────
function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

type TimeMode = 'now' | 'minus30' | 'minus60' | 'custom'
const symptomTime  = ref(formatTime(new Date()))
const timeMode     = ref<TimeMode>('now')
const showTimeInput = ref(false)

function setTimeNow() {
  timeMode.value      = 'now'
  showTimeInput.value = false
  symptomTime.value   = formatTime(new Date())
}
function setTimeMinus(minutes: number, mode: 'minus30' | 'minus60') {
  timeMode.value      = mode
  showTimeInput.value = false
  const d = new Date()
  d.setMinutes(d.getMinutes() - minutes)
  symptomTime.value = formatTime(d)
}
function setTimeCustom() {
  timeMode.value      = 'custom'
  showTimeInput.value = true
}

// ── 2. 증상 종류 (다중 선택) ────────────────────────────────
interface SymptomGroup {
  key:   string
  label: string
  emoji: string
  color: string
  bg:    string
  chips: { key: string; label: string }[]
}

const SYMPTOM_GROUPS: SymptomGroup[] = [
  {
    key:   'skin',
    label: '피부',
    emoji: '🧴',
    color: '#E8879F',
    bg:    'rgba(232,135,159,0.12)',
    chips: [
      { key: '100', label: '가려움' },
      { key: '101', label: '두드러기' },
      { key: '102', label: '붉어짐' },
      { key: '103', label: '열감' },
      { key: '104', label: '붓기' },
    ],
  },
  {
    key:   'respiratory',
    label: '비염/호흡기',
    emoji: '🤧',
    color: '#4B9EE8',
    bg:    'rgba(75,158,232,0.12)',
    chips: [
      { key: '200', label: '콧물' },
      { key: '201', label: '재채기' },
      { key: '202', label: '코막힘' },
      { key: '203', label: '눈 가려움' },
      { key: '204', label: '기침' },
    ],
  },
  {
    key:   'other',
    label: '기타',
    emoji: '😵',
    color: '#9B7FD4',
    bg:    'rgba(155,127,212,0.12)',
    chips: [
      { key: '300', label: '복통' },
      { key: '301', label: '어지러움' },
    ],
  },
]

const selectedSymptoms = ref<Set<string>>(new Set())
const selectedCount    = computed(() => selectedSymptoms.value.size)

function getGroupColor(key: string): string {
  for (const g of SYMPTOM_GROUPS) {
    if (g.chips.some(c => c.key === key)) return g.color
  }
  return '#E8879F'
}
function getGroupBg(key: string): string {
  for (const g of SYMPTOM_GROUPS) {
    if (g.chips.some(c => c.key === key)) return g.bg
  }
  return 'rgba(232,135,159,0.12)'
}
function toggleSymptom(key: string) {
  const s = new Set(selectedSymptoms.value)
  s.has(key) ? s.delete(key) : s.add(key)
  selectedSymptoms.value = s
}

// 피부 증상이 하나라도 선택된 경우에만 발생 부위 섹션 표시
const hasSkinSymptom = computed(() =>
  [...selectedSymptoms.value].some(k => SKIN_SYMPTOM_CODES.has(k as any))
)
// selectedBodyParts를 여기서 먼저 선언해야 watch에서 참조 가능
const selectedBodyParts = ref<Set<string>>(new Set())
// 피부 증상이 모두 해제되면 선택된 발생 부위도 초기화
watch(hasSkinSymptom, (active) => {
  if (!active) selectedBodyParts.value = new Set()
})

// ── 3. 증상 강도 ────────────────────────────────────────────
const intensity = ref(3)

interface IntensityLevel {
  label: string
  color: string
  desc:  string
}

const intensityLevel = computed<IntensityLevel>(() => {
  if (intensity.value <= 3) return { label: '경미', color: '#34A853', desc: '거슬리지만 일상생활 가능해요' }
  if (intensity.value <= 6) return { label: '보통', color: '#F4A020', desc: '계속 신경 쓰이고 업무·공부에 방해돼요' }
  return { label: '심각', color: '#E53E3E', desc: '잠을 자기 어렵거나 일상생활이 불가해요' }
})

const showMedModal = ref(false)

// 팝업은 저장 완료 후 intensity >= 7일 때만 표시 (슬라이더 이벤트 아님)
function goToMain() {
  showMedModal.value = false
  router.push('/')
}
function goToMedRecord() {
  showMedModal.value = false
  router.push('/medication-record' + (dateParam.value ? '?date=' + dateParam.value : ''))
}

// ── 4. 발생 부위 (칩 선택기) ────────────────────────────────
interface BodyChip      { key: string; label: string }
interface BodyPartGroup {
  key:   string
  label: string
  icon:  string
  color: string
  bg:    string
  chips: BodyChip[]
}

const BODY_GROUPS: BodyPartGroup[] = [
  {
    key: 'head_neck', label: '머리·목', icon: '🙂', color: '#9B7FD4', bg: 'rgba(155,127,212,0.12)',
    chips: [
      { key: 'head', label: '머리' },
      { key: 'face', label: '얼굴' },
      { key: 'neck', label: '목' },
    ],
  },
  {
    key: 'shoulder', label: '어깨', icon: '💪', color: '#4B9EE8', bg: 'rgba(75,158,232,0.12)',
    chips: [
      { key: 'l_shoulder', label: '왼쪽 어깨' },
      { key: 'r_shoulder', label: '오른쪽 어깨' },
    ],
  },
  {
    key: 'torso', label: '상체', icon: '👕', color: '#E8A020', bg: 'rgba(232,160,32,0.12)',
    chips: [
      { key: 'chest',      label: '가슴' },
      { key: 'abdomen',    label: '복부' },
      { key: 'upper_back', label: '등 위쪽' },
      { key: 'lower_back', label: '허리' },
    ],
  },
  {
    key: 'arms_hands', label: '팔·손', icon: '🤲', color: '#E8879F', bg: 'rgba(232,135,159,0.12)',
    chips: [
      { key: 'l_arm',   label: '왼팔' },
      { key: 'r_arm',   label: '오른팔' },
      { key: 'l_elbow', label: '왼쪽 팔꿈치' },
      { key: 'r_elbow', label: '오른쪽 팔꿈치' },
      { key: 'l_hand',  label: '왼손' },
      { key: 'r_hand',  label: '오른손' },
    ],
  },
  {
    key: 'lower', label: '하체', icon: '🦵', color: '#34A853', bg: 'rgba(52,168,83,0.12)',
    chips: [
      { key: 'l_hip',   label: '왼쪽 엉덩이' },
      { key: 'r_hip',   label: '오른쪽 엉덩이' },
      { key: 'l_thigh', label: '왼쪽 허벅지' },
      { key: 'r_thigh', label: '오른쪽 허벅지' },
      { key: 'l_knee',  label: '왼쪽 무릎' },
      { key: 'r_knee',  label: '오른쪽 무릎' },
      { key: 'l_calf',  label: '왼쪽 종아리' },
      { key: 'r_calf',  label: '오른쪽 종아리' },
    ],
  },
]

function getBodyColor(key: string): string {
  for (const g of BODY_GROUPS) {
    if (g.chips.some(c => c.key === key)) return g.color
  }
  return '#E8879F'
}
function getBodyBg(key: string): string {
  for (const g of BODY_GROUPS) {
    if (g.chips.some(c => c.key === key)) return g.bg
  }
  return 'rgba(232,135,159,0.12)'
}

function toggleBodyPart(key: string) {
  const s = new Set(selectedBodyParts.value)
  s.has(key) ? s.delete(key) : s.add(key)
  selectedBodyParts.value = s
}

// ── 제출 ────────────────────────────────────────────────────
const errorMsg     = ref('')
const isSubmitting = ref(false)

function validate(): boolean {
  if (selectedSymptoms.value.size === 0) {
    errorMsg.value = '증상 종류를 최소 한 가지 선택해주세요.'
    return false
  }
  errorMsg.value = ''
  return true
}

async function handleSubmit() {
  if (!validate()) return
  isSubmitting.value = true
  try {
    const uid = authStore.user!.uid

    // dateParam(YYYY-MM-DD) + symptomTime(HH:MM) → Firestore Timestamp
    const [year, month, day]   = dateParam.value.split('-').map(Number)
    const [hours, minutes]     = symptomTime.value.split(':').map(Number)
    const dateTimestamp = Timestamp.fromDate(
      new Date(year, month - 1, day, hours, minutes, 0)
    )

    await addDoc(collection(db, 'users', uid, 'allergyRecords'), {
      uid,
      date:      dateTimestamp,          // Timestamp (날짜 + 시각 통합)
      symptoms:  [...selectedSymptoms.value], // 공통코드 배열 ["100","201",...]
      intensity: intensity.value,
      createdAt: serverTimestamp(),
    })
    // 저장 성공 → 강도 7 이상이면 약 복용 팝업, 아니면 메인으로
    if (intensity.value >= 7) {
      showMedModal.value = true
    } else {
      router.push('/')
    }
  } catch (e) {
    console.error(e)
    errorMsg.value = '저장 중 오류가 발생했습니다. 다시 시도해주세요.'
  } finally {
    isSubmitting.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<template>
  <AppHeader :tabs="NAV_TABS" v-model:activeTab="activeTab" @tab-click="onTabClick" />

  <div class="page-body allergy-page">

    <!-- ── 히어로 ── -->
    <div class="allergy-hero">
      <button class="btn-back" type="button" aria-label="뒤로가기" @click="goBack">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="allergy-hero-body">
        <span class="allergy-hero-badge">🤧 알러지 기록</span>
        <h1 class="allergy-hero-title">증상을 기록해요</h1>
        <div class="allergy-hero-date">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>{{ dateParts.y }}년 {{ dateParts.m }}월 {{ dateParts.d }}일 {{ dateParts.dowLabel }}</span>
        </div>
      </div>
      <div class="allergy-hero-deco" aria-hidden="true"></div>
    </div>

    <form class="allergy-form" @submit.prevent="handleSubmit">

      <!-- ── 1. 증상 발생 시각 ── -->
      <div class="allergy-section">
        <div class="allergy-section-label">
          <span class="allergy-section-num">1</span>
          증상 발생 시각
        </div>
        <div class="time-picker">
          <div class="time-display-row">
            <div class="time-display">{{ symptomTime }}</div>
            <div class="time-preset-btns">
              <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'now' }"     @click="setTimeNow">지금</button>
              <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'minus30' }" @click="setTimeMinus(30, 'minus30')">30분 전</button>
              <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'minus60' }" @click="setTimeMinus(60, 'minus60')">1시간 전</button>
              <button type="button" class="btn-time-preset" :class="{ active: timeMode === 'custom' }"  @click="setTimeCustom">직접 입력</button>
            </div>
          </div>
          <Transition name="expand-down">
            <div v-if="showTimeInput" class="time-input-wrap">
              <input type="time" v-model="symptomTime" class="time-input" />
            </div>
          </Transition>
        </div>
      </div>

      <!-- ── 2. 증상 종류 ── -->
      <div class="allergy-section">
        <div class="allergy-section-label">
          <span class="allergy-section-num">2</span>
          증상 종류
          <span v-if="selectedCount > 0" class="allergy-section-count">{{ selectedCount }}개 선택됨</span>
        </div>
        <div class="symptom-groups">
          <div v-for="group in SYMPTOM_GROUPS" :key="group.key" class="symptom-group">
            <div class="symptom-group-header" :style="{ '--gc': group.color, '--gb': group.bg }">
              <span class="symptom-group-emoji">{{ group.emoji }}</span>
              {{ group.label }}
            </div>
            <div class="symptom-chips">
              <button
                v-for="chip in group.chips"
                :key="chip.key"
                type="button"
                class="symptom-chip"
                :class="{ active: selectedSymptoms.has(chip.key) }"
                :style="selectedSymptoms.has(chip.key)
                  ? { '--cc': getGroupColor(chip.key), '--cb': getGroupBg(chip.key) }
                  : {}"
                @click="toggleSymptom(chip.key)"
              >
                <svg v-if="selectedSymptoms.has(chip.key)" class="chip-check" width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ chip.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── 3. 증상 강도 ── -->
      <div class="allergy-section">
        <div class="allergy-section-label">
          <span class="allergy-section-num">3</span>
          증상 강도
        </div>
        <div class="intensity-wrap">
          <div class="intensity-header">
            <div class="intensity-value-wrap">
              <span class="intensity-value" :style="{ color: intensityLevel.color }">{{ intensity }}</span>
              <span class="intensity-unit">/ 10</span>
            </div>
            <span class="intensity-badge" :style="{ background: intensityLevel.color + '22', color: intensityLevel.color }">
              {{ intensityLevel.label }}
            </span>
          </div>

          <div class="intensity-slider-track">
            <input
              type="range"
              min="1" max="10" step="1"
              v-model.number="intensity"
              class="intensity-slider"
              :style="{ '--pct': ((intensity - 1) / 9 * 100) + '%', '--clr': intensityLevel.color }"
            />
            <!-- 구간 마커 -->
            <div class="intensity-zones">
              <span class="intensity-zone green">경미<br>1–3</span>
              <span class="intensity-zone yellow">보통<br>4–6</span>
              <span class="intensity-zone red">심각<br>7–10</span>
            </div>
          </div>

          <p class="intensity-desc" :style="{ color: intensityLevel.color }">
            {{ intensityLevel.desc }}
          </p>
        </div>
      </div>

      <!-- ── 4. 발생 부위 — 피부 증상 선택 시에만 노출 ── -->
      <Transition name="section-fade">
      <div v-if="hasSkinSymptom" class="allergy-section">
        <div class="allergy-section-label">
          <span class="allergy-section-num">4</span>
          발생 부위
          <span v-if="selectedBodyParts.size > 0" class="allergy-section-count">{{ selectedBodyParts.size }}곳 선택됨</span>
          <span class="allergy-section-optional">선택</span>
        </div>
        <div class="symptom-groups">
          <div v-for="group in BODY_GROUPS" :key="group.key" class="symptom-group">
            <div class="symptom-group-header" :style="{ '--gc': group.color, '--gb': group.bg }">
              <span class="symptom-group-emoji">{{ group.icon }}</span>
              {{ group.label }}
            </div>
            <div class="symptom-chips">
              <button
                v-for="chip in group.chips"
                :key="chip.key"
                type="button"
                class="symptom-chip"
                :class="{ active: selectedBodyParts.has(chip.key) }"
                :style="selectedBodyParts.has(chip.key)
                  ? { '--cc': getBodyColor(chip.key), '--cb': getBodyBg(chip.key) }
                  : {}"
                @click="toggleBodyPart(chip.key)"
              >
                <svg v-if="selectedBodyParts.has(chip.key)" class="chip-check" width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ chip.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
      </Transition>

      <!-- 에러 -->
      <Transition name="su-error-slide">
        <div v-if="errorMsg" class="su-error">
          <span class="su-error-icon">⚠️</span>
          {{ errorMsg }}
        </div>
      </Transition>

      <!-- 제출 -->
      <div class="diet-submit-wrap">
        <button class="allergy-submit-btn" type="submit" :disabled="isSubmitting">
          <span v-if="isSubmitting" class="diet-submit-spinner"></span>
          <template v-else>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 8.5l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            기록 저장하기
          </template>
        </button>
      </div>

    </form>
  </div>

  <!-- ── 약 복용 모달 ── -->
  <Teleport to="body">
    <Transition name="cs-modal">
      <div v-if="showMedModal" class="cs-overlay" @click.self="goToMain">
        <div class="med-card">
          <button class="cs-close" type="button" aria-label="닫기" @click="goToMain">✕</button>
          <div class="med-card-icon">💊</div>
          <span class="med-card-badge">증상 강도: 심각</span>
          <h3 class="med-card-title">약을 복용하셨나요?</h3>
          <p class="med-card-desc">
            증상 강도가 심각 수준이에요.<br>
            약 복용 기록을 함께 남기면 더 정확한 분석이 가능해요.
          </p>
          <button class="med-card-btn-primary" type="button" @click="goToMedRecord">
            💊 약 복용 기록하기
          </button>
          <button class="med-card-btn-secondary" type="button" @click="goToMain">
            메인 화면으로
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
