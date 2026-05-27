<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppHeader, { type NavTab } from '@/components/AppHeader.vue'
import MedicationIntakeSheet from '@/components/MedicationIntakeSheet.vue'
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/firebase'

const router    = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.user)
const userName = computed(() => {
  const u = user.value
  if (!u) return '사용자'
  return u.displayName || u.email?.split('@')[0] || '사용자'
})

const NAV_TABS: NavTab[] = [
  { key: 'home',    label: '홈' },
  { key: 'records', label: '기록' },
  { key: 'stats',   label: '통계' },
]

// ── 날짜 헤더 ──
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']
const now    = new Date()
const greetingDate = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${DAY_KO[now.getDay()]}요일`

// ── 캘린더 ──
const HOLIDAYS: Record<number, Record<string, string>> = {
  2024: {
    '1-1':'신정',
    '2-9':'설날연휴','2-10':'설날','2-11':'설날연휴','2-12':'대체공휴일',
    '3-1':'삼일절',
    '4-10':'국회의원선거',
    '5-5':'어린이날','5-6':'대체공휴일','5-15':'부처님오신날',
    '6-6':'현충일',
    '8-15':'광복절',
    '9-16':'추석연휴','9-17':'추석','9-18':'추석연휴',
    '10-3':'개천절','10-9':'한글날',
    '12-25':'성탄절'
  },
  2025: {
    '1-1':'신정',
    '1-27':'임시공휴일','1-28':'설날연휴','1-29':'설날','1-30':'설날연휴',
    '3-1':'삼일절','3-3':'대체공휴일',
    '5-5':'어린이날·부처님오신날','5-6':'대체공휴일',
    '6-3':'제21대대통령선거','6-6':'현충일',
    '8-15':'광복절',
    '10-3':'개천절','10-5':'추석연휴','10-6':'추석','10-7':'추석연휴','10-8':'대체공휴일','10-9':'한글날',
    '12-25':'성탄절'
  },
  2026: {
    '1-1':'신정',
    '2-16':'설날연휴','2-17':'설날','2-18':'설날연휴',
    '3-1':'삼일절','3-2':'대체공휴일',
    '5-1':'노동절','5-5':'어린이날','5-24':'부처님오신날','5-25':'대체공휴일',
    '6-3':'지방선거','6-6':'현충일',
    '7-17':'제헌절',
    '8-15':'광복절','8-17':'대체공휴일',
    '9-24':'추석연휴','9-25':'추석','9-26':'추석연휴',
    '10-3':'개천절','10-5':'대체공휴일','10-9':'한글날',
    '12-25':'성탄절'
  },
  2027: {
    '1-1':'신정',
    '2-6':'설날연휴','2-7':'설날','2-8':'설날연휴','2-9':'대체공휴일',
    '3-1':'삼일절',
    '5-5':'어린이날','5-13':'부처님오신날',
    '6-6':'현충일',
    '7-17':'제헌절',
    '8-15':'광복절','8-16':'대체공휴일',
    '9-14':'추석연휴','9-15':'추석','9-16':'추석연휴',
    '10-3':'개천절','10-4':'대체공휴일','10-9':'한글날','10-11':'대체공휴일',
    '12-25':'성탄절','12-27':'대체공휴일'
  },
  2028: {
    '1-1':'신정',
    '1-25':'설날연휴','1-26':'설날','1-27':'설날연휴',
    '3-1':'삼일절',
    '5-2':'부처님오신날','5-5':'어린이날',
    '6-6':'현충일','8-15':'광복절',
    '9-9':'추석연휴','9-10':'추석','9-11':'추석연휴','9-12':'대체공휴일',
    '10-3':'개천절','10-9':'한글날',
    '12-25':'성탄절'
  }
}

interface CalCell {
  empty: boolean
  date?: number
  dateStr?: string
  isToday?: boolean
  isRed?: boolean
  isBlue?: boolean
  holidayName?: string | null
  allergyIntensity?: number
  hasDiet?: boolean
  hasMed?: boolean
}

const today        = new Date()
const currentYear  = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())
const activeTab    = ref<'home' | 'records' | 'stats'>('home')

// ── 알러지 통계 ──
const allergyMonthCount = ref(0)
const allergyDayMap     = ref<Map<string, number>>(new Map())

async function fetchAllergyRecords() {
  const uid = authStore.user?.uid
  if (!uid) return

  const year  = currentYear.value
  const month = currentMonth.value

  const start = Timestamp.fromDate(new Date(year, month, 1, 0, 0, 0))
  const end   = Timestamp.fromDate(new Date(year, month + 1, 1, 0, 0, 0))

  const q = query(
    collection(db, 'users', uid, 'allergyRecords'),
    where('date', '>=', start),
    where('date', '<',  end),
  )

  const snap = await getDocs(q)
  const map  = new Map<string, number>()

  snap.forEach(doc => {
    const data      = doc.data()
    const ts        = data.date as Timestamp
    const d         = ts.toDate()
    const dateStr   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const intensity = (data.intensity as number) ?? 0
    map.set(dateStr, Math.max(map.get(dateStr) ?? 0, intensity))
  })

  allergyDayMap.value     = map
  allergyMonthCount.value = snap.size
}

// ── 식단 통계 ──
const dietMonthCount = ref(0)
const dietDaySet     = ref<Set<string>>(new Set())

async function fetchDietRecords() {
  const uid = authStore.user?.uid
  if (!uid) return

  const year  = currentYear.value
  const month = currentMonth.value

  const start = Timestamp.fromDate(new Date(year, month, 1, 0, 0, 0))
  const end   = Timestamp.fromDate(new Date(year, month + 1, 1, 0, 0, 0))

  const q = query(
    collection(db, 'users', uid, 'dietRecords'),
    where('date', '>=', start),
    where('date', '<',  end),
  )

  const snap = await getDocs(q)
  const set  = new Set<string>()

  snap.forEach(doc => {
    const data    = doc.data()
    const ts      = data.date as Timestamp
    const d       = ts.toDate()
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    set.add(dateStr)
  })

  dietDaySet.value     = set
  dietMonthCount.value = snap.size
}

// ── 약 복용 통계 ──
const medDaySet = ref<Set<string>>(new Set())

async function fetchMedRecords() {
  const uid = authStore.user?.uid
  if (!uid) return

  const year  = currentYear.value
  const month = currentMonth.value

  const start = Timestamp.fromDate(new Date(year, month, 1, 0, 0, 0))
  const end   = Timestamp.fromDate(new Date(year, month + 1, 1, 0, 0, 0))

  const q = query(
    collection(db, 'users', uid, 'medicationRecords'),
    where('takenAt', '>=', start),
    where('takenAt', '<',  end),
  )

  const snap = await getDocs(q)
  const set  = new Set<string>()

  snap.forEach(doc => {
    const data    = doc.data()
    const ts      = data.takenAt as Timestamp
    const d       = ts.toDate()
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    set.add(dateStr)
  })

  medDaySet.value = set
}

async function fetchMonthData() {
  await Promise.all([fetchAllergyRecords(), fetchDietRecords(), fetchMedRecords()])
}

watch([currentYear, currentMonth], fetchMonthData, { immediate: true })

const calTitle = computed(() =>
  `${currentYear.value}년 ${currentMonth.value + 1}월`
)

const calendar = computed(() => {
  const year        = currentYear.value
  const month       = currentMonth.value
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const holidays    = HOLIDAYS[year] || {}
  const totalRows   = Math.ceil((firstDay + daysInMonth) / 7)
  const totalCells  = totalRows * 7
  const cells: CalCell[] = []

  for (let i = 0; i < firstDay; i++) cells.push({ empty: true })

  for (let d = 1; d <= daysInMonth; d++) {
    const dow         = (firstDay + d - 1) % 7
    const holidayName = holidays[`${month + 1}-${d}`] ?? null
    const isToday     = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
    const isRed       = dow === 0 || !!holidayName
    const isBlue      = dow === 6 && !holidayName
    const dateStr          = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const allergyIntensity = allergyDayMap.value.get(dateStr)
    const hasDiet          = dietDaySet.value.has(dateStr)
    const hasMed           = medDaySet.value.has(dateStr)
    cells.push({ empty: false, date: d, dateStr, isToday, isRed, isBlue, holidayName, allergyIntensity, hasDiet, hasMed })
  }

  const trailing = totalCells - firstDay - daysInMonth
  for (let i = 0; i < trailing; i++) cells.push({ empty: true })

  return { cells, totalRows }
})

function changeMonth(delta: number) {
  currentMonth.value += delta
  if (currentMonth.value > 11) { currentMonth.value = 0;  currentYear.value++ }
  if (currentMonth.value < 0)  { currentMonth.value = 11; currentYear.value-- }
}

function goToday() {
  const t = new Date()
  currentYear.value  = t.getFullYear()
  currentMonth.value = t.getMonth()
  selectedDate.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

// ── 날짜 선택 ──
const selectedDate = ref<string | null>(null)

// 선택된 날짜의 표시용 라벨 (예: "5월 8일 목요일")
const selectedDateLabel = computed(() => {
  const src = selectedDate.value
  if (!src) {
    const d = now
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_KO[d.getDay()]}요일`
  }
  const [y, m, d] = src.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return `${m}월 ${d}일 ${DAY_KO[dow]}요일`
})

// 선택된 날짜의 전체 라벨 (다이얼로그 헤더용)
const selectedDateFull = computed(() => {
  const src = selectedDate.value
  if (!src) {
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`
  }
  const [y, m, d] = src.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return `${y}년 ${m}월 ${d}일 ${DAY_KO[dow]}요일`
})

function selectDate(dateStr: string | undefined) {
  if (!dateStr) return
  // 같은 날짜 재클릭 시 선택 해제
  selectedDate.value = selectedDate.value === dateStr ? null : dateStr
}

// ── 기록 추가 다이얼로그 ──
const showDialog  = ref(false)
const showMedSheet = ref(false)

function openDialog()  { showDialog.value = true }
function closeDialog() { showDialog.value = false }

function selectRecord(type: 'allergy' | 'diet' | 'medication') {
  closeDialog()
  const dateQuery = selectedDate.value ? `?date=${selectedDate.value}` : ''
  if (type === 'diet')          router.push(`/diet-record${dateQuery}`)
  else if (type === 'allergy')  router.push(`/allergy-record${dateQuery}`)
  else if (type === 'medication') showMedSheet.value = true
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showDialog.value) closeDialog()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <AppHeader :tabs="NAV_TABS" v-model:activeTab="activeTab" />

  <!-- Page Body -->
  <div class="page-body">
    <!-- Greeting -->
    <div class="page-greeting">
      <div>
        <p class="greeting-date">{{ greetingDate }}</p>
        <h1 class="greeting-title">
          안녕하세요 <span class="name-highlight">{{ userName }}</span>님 👋
        </h1>
      </div>

      <!-- 데스크톱 전용 버튼 영역 -->
      <div class="btn-add-desktop-wrap">
        <Transition name="chip">
          <div v-if="selectedDate" class="selected-date-chip">
            <span class="chip-label">{{ selectedDateLabel }}</span>
            <button class="chip-clear" type="button" aria-label="선택 해제" @click="selectedDate = null">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </Transition>
        <button class="btn-add-record btn-add-desktop" type="button" @click="openDialog">
          <span class="btn-add-icon">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="btn-add-label">기록 추가</span>
        </button>
      </div>
    </div>

    <!-- 모바일 전용 액션 바 -->
    <div class="mob-action-bar">
      <!-- 왼쪽: 날짜 선택 영역 (항상 공간 유지, 레이아웃 고정) -->
      <button
        class="mob-date-area"
        type="button"
        :class="{ 'has-date': selectedDate }"
        :aria-label="selectedDate ? '날짜 선택 해제' : '캘린더에서 날짜를 선택하세요'"
        @click="selectedDate ? (selectedDate = null) : undefined"
      >
        <span class="mob-date-icon">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="mob-date-text">
          <template v-if="selectedDate">{{ selectedDateLabel }}</template>
          <template v-else>날짜를 선택하세요</template>
        </span>
        <Transition name="mob-x">
          <span v-if="selectedDate" class="mob-date-clear" aria-hidden="true">
            <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </span>
        </Transition>
      </button>

      <!-- 오른쪽: 기록 추가 버튼 (항상 고정) -->
      <button class="btn-add-record btn-add-mobile" type="button" @click="openDialog">
        <span class="btn-add-icon">
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="btn-add-label">기록 추가</span>
      </button>
    </div>

    <!-- Stats -->
    <div class="stats-row" id="allergy-stats">
      <div class="stat-card">
        <div class="stat-icon-wrap pink">🤧</div>
        <div class="stat-body">
          <div class="stat-num"><span>{{ allergyMonthCount }}</span><span class="stat-unit">회</span></div>
          <div class="stat-label">이번 달 알러지</div>
          <div class="stat-trend"></div>
        </div>
      </div>
      <div class="stat-card" id="diet-stats">
        <div class="stat-icon-wrap green">🥗</div>
        <div class="stat-body">
          <div class="stat-num"><span>{{ dietMonthCount }}</span><span class="stat-unit">회</span></div>
          <div class="stat-label">이번 달 식단 기록</div>
          <div class="stat-trend"></div>
        </div>
      </div>
    </div>

    <!-- Calendar -->
    <div class="calendar-card">
      <div class="cal-header">
        <h2 class="cal-title">{{ calTitle }}</h2>
        <div class="cal-nav-group">
          <button class="cal-nav" aria-label="이전 달" @click="changeMonth(-1)">&#8249;</button>
          <button class="btn-today" type="button" @click="goToday">오늘</button>
          <button class="cal-nav" aria-label="다음 달" @click="changeMonth(1)">&#8250;</button>
        </div>
      </div>
      <div class="cal-day-headers">
        <div class="cal-day-header sun">일</div>
        <div class="cal-day-header">월</div>
        <div class="cal-day-header">화</div>
        <div class="cal-day-header">수</div>
        <div class="cal-day-header">목</div>
        <div class="cal-day-header">금</div>
        <div class="cal-day-header sat">토</div>
      </div>
      <div class="cal-grid" :style="{ gridTemplateRows: `repeat(${calendar.totalRows}, 1fr)` }">
        <div
          v-for="(cell, idx) in calendar.cells"
          :key="idx"
          class="cal-cell"
          :class="{
            empty:    cell.empty,
            selected: !cell.empty && selectedDate === cell.dateStr,
            'has-allergy-mild':     !cell.empty && !!cell.allergyIntensity && cell.allergyIntensity <= 3,
            'has-allergy-moderate': !cell.empty && !!cell.allergyIntensity && cell.allergyIntensity >= 4 && cell.allergyIntensity <= 6,
            'has-allergy-severe':   !cell.empty && !!cell.allergyIntensity && cell.allergyIntensity >= 7,
          }"
          :data-date="cell.dateStr"
          @click="selectDate(cell.dateStr)"
        >
          <template v-if="!cell.empty">
            <span
              class="cal-num"
              :class="{
                today: cell.isToday,
                red:   cell.isRed  && !cell.isToday,
                blue:  cell.isBlue && !cell.isToday
              }"
            >{{ cell.date }}</span>
            <span v-if="cell.holidayName" class="cal-holiday">{{ cell.holidayName }}</span>
            <div class="cal-dots">
              <span
                v-if="cell.allergyIntensity"
                class="allergy-badge"
                :class="{
                  'badge-mild':     cell.allergyIntensity <= 3,
                  'badge-moderate': cell.allergyIntensity >= 4 && cell.allergyIntensity <= 6,
                  'badge-severe':   cell.allergyIntensity >= 7,
                }"
                :aria-label="`알러지 강도 ${cell.allergyIntensity}`"
              >{{ cell.allergyIntensity }}</span>
              <span
                v-if="cell.hasDiet"
                class="diet-badge"
                aria-label="식단 기록 있음"
              >🥗</span>
              <span
                v-if="cell.hasMed"
                class="med-badge"
                aria-label="약 복용 기록 있음"
              >💊</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 약 복용 기록 바텀시트 ── -->
  <MedicationIntakeSheet
    :visible="showMedSheet"
    @close="showMedSheet = false"
    @saved="showMedSheet = false"
  />

  <!-- ── 기록 추가 다이얼로그 ── -->
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="showDialog"
        class="rd-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="기록 추가"
        @click.self="closeDialog"
      >
        <div class="rd-sheet">
          <!-- 핸들 (모바일 바텀시트 느낌) -->
          <div class="rd-handle"></div>

          <!-- 헤더 -->
          <div class="rd-header">
            <div class="rd-header-text">
              <p class="rd-eyebrow">{{ selectedDate ? selectedDateFull : greetingDate }}</p>
              <h3 class="rd-title">어떤 기록을 추가할까요?</h3>
            </div>
            <button class="rd-close" type="button" aria-label="닫기" @click="closeDialog">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 선택 카드 -->
          <div class="rd-options">
            <!-- 알러지 -->
            <button class="rd-option" type="button" @click="selectRecord('allergy')">
              <div class="rd-option-icon allergy">🤧</div>
              <div class="rd-option-body">
                <span class="rd-option-title">알러지 기록</span>
                <span class="rd-option-desc">증상, 발생 부위, 반응 정도를 기록해요</span>
              </div>
              <div class="rd-option-arrow">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>

            <!-- 식단 -->
            <button class="rd-option" type="button" @click="selectRecord('diet')">
              <div class="rd-option-icon diet">🥗</div>
              <div class="rd-option-body">
                <span class="rd-option-title">식단 기록</span>
                <span class="rd-option-desc">오늘 먹은 음식과 식사 시간을 기록해요</span>
              </div>
              <div class="rd-option-arrow">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>

            <!-- 약 복용 -->
            <button class="rd-option" type="button" @click="selectRecord('medication')">
              <div class="rd-option-icon medication">💊</div>
              <div class="rd-option-body">
                <span class="rd-option-title">약 복용 기록</span>
                <span class="rd-option-desc">복용한 약 이름, 용량, 시간을 기록해요</span>
              </div>
              <div class="rd-option-arrow">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
