<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppHeader, { type NavTab } from '@/components/AppHeader.vue'
import MedicationIntakeSheet from '@/components/MedicationIntakeSheet.vue'
import { collection, query, where, getDocs, getDoc, doc, Timestamp } from 'firebase/firestore'
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

watch(activeTab, (tab) => {
  if (tab === 'records') router.push('/records')
})

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

// ── 날짜별 타임라인 ──────────────────────────────────────────
type TLType = 'allergy' | 'diet' | 'medication'

interface AllergenDef {
  emoji:   string
  name_ko: string
}

interface FoodEntry {
  name:       string
  amount:     number
  allergens?: string[]   // allergen 코드 배열 (allergies 컬렉션 문서 ID)
}

interface TimelineItem {
  type:    TLType
  sortTime: Date
  timeStr:  string
  // allergy
  intensity?:  number
  symptoms?:   string[]
  bodyParts?:  string[]
  // diet
  mealType?:   string
  foodItems?:  FoodEntry[]
  // medication
  medicationNickname?: string
  medicationType?:     string
  // common
  memo?: string
}

const MED_EMOJI: Record<string, string> = {
  PILL: '💊', OINTMENT: '🧴', NASAL_SPRAY: '👃', EYE_DROP: '👁️', SYRUP: '🥤',
}

// 알러지 증상 코드 → 한국어 라벨
const SYMPTOM_LABEL: Record<string, string> = {
  '100': '가려움',  '101': '두드러기', '102': '붉어짐',    '103': '열감',    '104': '붓기',
  '200': '콧물',    '201': '재채기',   '202': '코막힘',    '203': '눈 가려움', '204': '기침',
  '300': '복통',    '301': '어지러움',
}

const BODY_PART_LABEL: Record<string, string> = {
  head: '머리', face: '얼굴', neck: '목',
  l_shoulder: '왼쪽 어깨', r_shoulder: '오른쪽 어깨',
  chest: '가슴', abdomen: '복부', upper_back: '등 위쪽', lower_back: '허리',
  l_arm: '왼팔', r_arm: '오른팔', l_elbow: '왼쪽 팔꿈치', r_elbow: '오른쪽 팔꿈치',
  l_hand: '왼손', r_hand: '오른손',
  l_hip: '왼쪽 엉덩이', r_hip: '오른쪽 엉덩이',
  l_thigh: '왼쪽 허벅지', r_thigh: '오른쪽 허벅지',
  l_knee: '왼쪽 무릎', r_knee: '오른쪽 무릎',
  l_calf: '왼쪽 종아리', r_calf: '오른쪽 종아리',
}

// 식사 타입 코드 → 한국어 라벨
const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식',
}
const MEAL_TYPE_EMOJI: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪',
}

// allergies 컬렉션 정의 (코드 → { emoji, name_ko })
const allergenMap = ref<Map<string, AllergenDef>>(new Map())

// 내 알러지 목록 (users/{uid}.allergens)
const myAllergens = ref<string[]>([])

async function fetchAllergenDefs() {
  if (allergenMap.value.size > 0) return  // 이미 로드됨
  try {
    const snap = await getDocs(collection(db, 'allergies'))
    const map  = new Map<string, AllergenDef>()
    snap.forEach(doc => {
      const d = doc.data()
      map.set(doc.id, { emoji: d.emoji as string, name_ko: d.name_ko as string })
    })
    allergenMap.value = map
  } catch (e) {
    console.error('[MainView] fetchAllergenDefs 오류:', e)
  }
}

async function fetchMyAllergens() {
  const uid = authStore.user?.uid
  if (!uid) return
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    myAllergens.value = (snap.data()?.allergens as string[]) ?? []
  } catch (e) {
    console.error('[MainView] fetchMyAllergens 오류:', e)
  }
}

const showTimeline    = ref(false)
const timelineLoading = ref(false)
const timelineItems   = ref<TimelineItem[]>([])

function tlFmt(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function tlIntensityClass(intensity?: number) {
  if (!intensity) return ''
  if (intensity <= 3) return 'tl-intensity-mild'
  if (intensity <= 6) return 'tl-intensity-moderate'
  return 'tl-intensity-severe'
}

async function fetchDayRecords(dateStr: string) {
  const uid = authStore.user?.uid
  if (!uid) return

  const [y, m, d] = dateStr.split('-').map(Number)
  const start = Timestamp.fromDate(new Date(y, m - 1, d,     0, 0, 0))
  const end   = Timestamp.fromDate(new Date(y, m - 1, d + 1, 0, 0, 0))

  timelineLoading.value = true
  try {
    const [, allergySnap, dietSnap, medSnap] = await Promise.all([
      fetchAllergenDefs(),
      getDocs(query(collection(db, 'users', uid, 'allergyRecords'),
        where('date', '>=', start), where('date', '<', end))),
      getDocs(query(collection(db, 'users', uid, 'dietRecords'),
        where('date', '>=', start), where('date', '<', end))),
      getDocs(query(collection(db, 'users', uid, 'medicationRecords'),
        where('takenAt', '>=', start), where('takenAt', '<', end))),
    ])

    const items: TimelineItem[] = []

    allergySnap.forEach(doc => {
      const data = doc.data()
      const t    = (data.date as Timestamp).toDate()
      items.push({
        type: 'allergy', sortTime: t, timeStr: tlFmt(t),
        intensity: data.intensity as number,
        symptoms:  (data.symptoms  as string[]) ?? [],
        bodyParts: (data.bodyParts as string[]) ?? [],
        memo:      (data.memo as string) ?? '',
      })
    })

    dietSnap.forEach(doc => {
      const data     = doc.data()
      const t        = (data.date as Timestamp).toDate()
      const foodArr  = (data.foods as any[]) ?? []
      const foodItems: FoodEntry[] = foodArr
        .filter((f: any) => f.name)
        .map((f: any) => ({
          name:      f.name as string,
          amount:    (f.amount as number) ?? 1,
          allergens: (f.allergens as string[] | null) ?? [],
        }))
      items.push({
        type: 'diet', sortTime: t, timeStr: tlFmt(t),
        mealType:  (data.mealType as string) ?? '',
        foodItems,
        memo:      (data.memo as string) ?? '',
      })
    })

    await Promise.all(medSnap.docs.map(async (medDoc) => {
      const data         = medDoc.data()
      const t            = (data.takenAt as Timestamp).toDate()
      const medicationId = data.medicationId as string | undefined

      let nickname = ''
      let type     = ''
      if (medicationId) {
        try {
          const mSnap = await getDoc(doc(db, 'users', uid, 'medications', medicationId))
          if (mSnap.exists()) {
            nickname = (mSnap.data().nickname as string) ?? ''
            type     = (mSnap.data().type     as string) ?? ''
          }
        } catch { /* 약 삭제된 경우 무시 */ }
      }

      items.push({
        type: 'medication', sortTime: t, timeStr: tlFmt(t),
        medicationNickname: nickname,
        medicationType:     type,
      })
    }))

    items.sort((a, b) => a.sortTime.getTime() - b.sortTime.getTime())
    timelineItems.value = items

    if (items.length > 0) showTimeline.value = true
    else                   showTimeline.value = false
  } catch (e) {
    console.error('[MainView] fetchDayRecords 오류:', e)
    showTimeline.value = false
  } finally {
    timelineLoading.value = false
  }
}

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

async function selectDate(dateStr: string | undefined) {
  if (!dateStr) return

  // 이미 선택된 날짜를 다시 클릭하면 기록이 있을 때만 하루기록 팝업 노출
  if (selectedDate.value === dateStr) {
    timelineItems.value = []
    await fetchDayRecords(dateStr)
    // fetchDayRecords 내부에서 기록이 있을 때만 showTimeline = true 처리
    return
  }

  // 처음 클릭: 날짜만 선택
  selectedDate.value = dateStr
}

// ── 기록 추가 다이얼로그 ──
const showDialog  = ref(false)
const showMedSheet = ref(false)

function openDialog()  { showDialog.value = true }
function closeDialog() { showDialog.value = false }

async function onMedSaved() {
  showMedSheet.value = false
  await fetchMedRecords()
  const date = selectedDate.value
  if (date && showTimeline.value) {
    timelineItems.value = []
    await fetchDayRecords(date)
  }
}

function selectRecord(type: 'allergy' | 'diet' | 'medication') {
  closeDialog()
  const dateQuery = selectedDate.value ? `?date=${selectedDate.value}` : ''
  if (type === 'diet')          router.push(`/diet-record${dateQuery}`)
  else if (type === 'allergy')  router.push(`/allergy-record${dateQuery}`)
  else if (type === 'medication') showMedSheet.value = true
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showDialog.value)   closeDialog()
  if (showTimeline.value) showTimeline.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  fetchMyAllergens()
})
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
    :initialDate="selectedDate ? new Date(selectedDate) : null"
    @close="showMedSheet = false"
    @saved="onMedSaved"
  />

  <!-- ── 날짜별 타임라인 시트 ── -->
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="showTimeline"
        class="rd-backdrop"
        role="dialog"
        aria-modal="true"
        :aria-label="`${selectedDateFull} 기록`"
        @click.self="showTimeline = false"
      >
        <div class="rd-sheet tl-sheet">
          <div class="rd-handle"></div>

          <!-- 헤더 -->
          <div class="rd-header">
            <div class="rd-header-text">
              <p class="rd-eyebrow">{{ selectedDateFull }}</p>
              <h3 class="rd-title">하루 기록</h3>
            </div>
            <button class="rd-close" type="button" aria-label="닫기" @click="showTimeline = false">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 로딩 -->
          <div v-if="timelineLoading" class="tl-loading">
            <span class="tl-loading-spinner"></span>
            <span>기록 불러오는 중…</span>
          </div>

          <!-- 타임라인 본문 -->
          <div v-else class="tl-body">
            <div class="tl-list">
              <div
                v-for="(item, i) in timelineItems"
                :key="i"
                class="tl-item"
              >
                <!-- 시각 -->
                <div class="tl-time">{{ item.timeStr }}</div>

                <!-- 선 + 점 -->
                <div class="tl-connector">
                  <div v-if="i > 0" class="tl-line-pre"></div>
                  <div
                    class="tl-dot"
                    :class="[item.type === 'diet' ? `tl-dot-diet--${item.mealType ?? 'snack'}` : `tl-dot-${item.type}`, { 'tl-dot-first': i === 0 }]"
                  ></div>
                  <div v-if="i < timelineItems.length - 1" class="tl-line-post"></div>
                </div>

                <!-- 카드 -->
                <div class="tl-card" :class="[`tl-card-${item.type}`, item.type === 'diet' ? `tl-card-diet--${item.mealType ?? 'snack'}` : '']">

                  <!-- 알러지 -->
                  <template v-if="item.type === 'allergy'">
                    <div class="tl-card-header">
                      <span class="tl-icon">🤧</span>
                      <span class="tl-card-title">알러지 증상</span>
                      <span
                        v-if="item.intensity"
                        class="tl-badge"
                        :class="tlIntensityClass(item.intensity)"
                      >강도 {{ item.intensity }}</span>
                    </div>
                    <div v-if="item.symptoms?.length || item.bodyParts?.length" class="tl-chips">
                      <span v-for="s in item.symptoms"  :key="s" class="tl-chip tl-chip-symptom">
                        {{ SYMPTOM_LABEL[s] ?? s }}
                      </span>
                      <span v-for="b in item.bodyParts" :key="b" class="tl-chip tl-chip-body">
                        {{ BODY_PART_LABEL[b] ?? b }}
                      </span>
                    </div>
                    <p v-if="item.memo" class="tl-memo">{{ item.memo }}</p>
                  </template>

                  <!-- 식단 -->
                  <template v-else-if="item.type === 'diet'">
                    <div class="tl-card-header">
                      <span class="tl-icon">{{ MEAL_TYPE_EMOJI[item.mealType ?? ''] ?? '🥗' }}</span>
                      <span class="tl-card-title">식단 기록</span>
                      <span v-if="item.mealType" class="tl-badge" :class="`tl-badge-diet--${item.mealType}`">
                        {{ MEAL_TYPE_LABEL[item.mealType] ?? item.mealType }}
                      </span>
                    </div>
                    <div v-if="item.foodItems?.length" class="tl-food-list">
                      <div
                        v-for="(food, fi) in item.foodItems"
                        :key="fi"
                        class="tl-food-item"
                      >
                        <div class="tl-food-name-row">
                          <span class="tl-food-name">{{ food.name }}</span>
                          <span class="tl-food-amount">× {{ food.amount }}</span>
                        </div>
                        <div v-if="food.allergens?.some(c => myAllergens.includes(c))" class="tl-allergen-chips">
                          <template v-for="code in food.allergens" :key="code">
                            <span
                              v-if="allergenMap.get(code) && myAllergens.includes(code)"
                              class="tl-allergen-chip tl-allergen-chip--mine"
                            >
                              {{ allergenMap.get(code)!.emoji }} {{ allergenMap.get(code)!.name_ko }}
                            </span>
                          </template>
                        </div>
                      </div>
                    </div>
                    <p v-if="item.memo" class="tl-memo">{{ item.memo }}</p>
                  </template>

                  <!-- 약 복용 -->
                  <template v-else-if="item.type === 'medication'">
                    <div class="tl-card-header">
                      <span class="tl-icon">{{ MED_EMOJI[item.medicationType ?? ''] ?? '💊' }}</span>
                      <span class="tl-card-title">약 복용</span>
                    </div>
                    <p class="tl-med-name">{{ item.medicationNickname }}</p>
                  </template>

                </div>
              </div>
            </div>

            <!-- 전체 기록 보기 버튼 -->
            <button
              class="tl-goto-records-btn"
              type="button"
              @click="showTimeline = false; router.push(`/records?date=${selectedDate}`)"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              이 날의 기록 전체 보기
            </button>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>

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
