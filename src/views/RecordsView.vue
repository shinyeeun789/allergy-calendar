<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRoute, useRouter } from 'vue-router'
import AppHeader, { type NavTab } from '@/components/AppHeader.vue'
import MedicationIntakeSheet from '@/components/MedicationIntakeSheet.vue'
import { collection, query, where, getDocs, getDoc, doc, deleteDoc, Timestamp } from 'firebase/firestore'
import { db } from '@/firebase'

const authStore = useAuthStore()
const route     = useRoute()
const router    = useRouter()

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

// ── 날짜 선택 ──
const today = new Date()

function initDate(): Date {
  const q = route.query.date as string | undefined
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const [y, m, d] = q.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

const selectedDate = ref(initDate())

function fmtDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const selectedDateLabel = computed(() => {
  const d   = selectedDate.value
  const dow = DAY_KO[d.getDay()]
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${dow}요일`
})

function prevDay() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() - 1)
  selectedDate.value = d
}

function nextDay() {
  const d = new Date(selectedDate.value)
  d.setDate(d.getDate() + 1)
  selectedDate.value = d
}

const NAV_TABS: NavTab[] = [
  { key: 'home',    label: '홈' },
  { key: 'records', label: '기록' },
  { key: 'stats',   label: '통계' },
]

// ── 상단 탭 ──
const activeTab    = ref<'home' | 'records' | 'stats'>('records')
watch(activeTab, (tab) => {
  if (tab === 'home') router.push('/')
})

// ── 카테고리 필터 ──
type Category = 'all' | 'allergy' | 'diet' | 'medication'
const activeCategory = ref<Category>('all')

// ── 데이터 타입 ──
type TLType = 'allergy' | 'diet' | 'medication'

interface FoodEntry {
  name:      string
  amount:    number
  allergens?: string[]
}

interface AllergenDef {
  emoji:   string
  name_ko: string
}

interface TimelineItem {
  id:       string
  type:     TLType
  sortTime: Date
  timeStr:  string
  // allergy
  intensity?: number
  symptoms?:  string[]
  bodyParts?: string[]
  // diet
  mealType?:  string
  foodItems?: FoodEntry[]
  // medication
  medicationId?:       string
  medicationNickname?: string
  medicationType?:     string
  // common
  memo?: string
}

const SYMPTOM_LABEL: Record<string, string> = {
  '100': '가려움',   '101': '두드러기', '102': '붉어짐',     '103': '열감',      '104': '붓기',
  '200': '콧물',     '201': '재채기',   '202': '코막힘',     '203': '눈 가려움', '204': '기침',
  '300': '복통',     '301': '어지러움',
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

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식',
}
const MEAL_TYPE_EMOJI: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪',
}
const MED_EMOJI: Record<string, string> = {
  PILL: '💊', OINTMENT: '🧴', NASAL_SPRAY: '👃', EYE_DROP: '👁️', SYRUP: '🥤',
}
const MED_LABEL: Record<string, string> = {
  PILL: '알약', OINTMENT: '연고', NASAL_SPRAY: '비강 스프레이', EYE_DROP: '점안액', SYRUP: '시럽',
}

function tlFmt(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Firestore ──
const allergenMap = ref<Map<string, AllergenDef>>(new Map())
const allItems    = ref<TimelineItem[]>([])
const loading     = ref(false)

// 내 알러지 목록
const myAllergens = ref<string[]>([])

async function fetchMyAllergens() {
  const uid = authStore.user?.uid
  if (!uid) return
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    myAllergens.value = (snap.data()?.allergens as string[]) ?? []
  } catch (e) {
    console.error('[RecordsView] fetchMyAllergens 오류:', e)
  }
}

async function fetchAllergenDefs() {
  if (allergenMap.value.size > 0) return
  try {
    const snap = await getDocs(collection(db, 'allergies'))
    const map  = new Map<string, AllergenDef>()
    snap.forEach(doc => {
      const d = doc.data()
      map.set(doc.id, { emoji: d.emoji as string, name_ko: d.name_ko as string })
    })
    allergenMap.value = map
  } catch (e) {
    console.error('[RecordsView] fetchAllergenDefs 오류:', e)
  }
}

async function fetchDayRecords() {
  const uid = authStore.user?.uid
  if (!uid) return

  const dateStr = fmtDateStr(selectedDate.value)
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = Timestamp.fromDate(new Date(y, m - 1, d,     0, 0, 0))
  const end   = Timestamp.fromDate(new Date(y, m - 1, d + 1, 0, 0, 0))

  loading.value = true
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
        id: doc.id, type: 'allergy', sortTime: t, timeStr: tlFmt(t),
        intensity: data.intensity as number,
        symptoms:  (data.symptoms  as string[]) ?? [],
        bodyParts: (data.bodyParts as string[]) ?? [],
        memo:      (data.memo as string) ?? '',
      })
    })

    dietSnap.forEach(doc => {
      const data    = doc.data()
      const t       = (data.date as Timestamp).toDate()
      const foodArr = (data.foods as any[]) ?? []
      const foodItems: FoodEntry[] = foodArr
        .filter((f: any) => f.name)
        .map((f: any) => ({
          name:      f.name as string,
          amount:    (f.amount as number) ?? 1,
          allergens: (f.allergens as string[] | null) ?? [],
        }))
      items.push({
        id: doc.id, type: 'diet', sortTime: t, timeStr: tlFmt(t),
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
        id: medDoc.id, type: 'medication', sortTime: t, timeStr: tlFmt(t),
        medicationId:       medicationId ?? '',
        medicationNickname: nickname,
        medicationType:     type,
        memo:               (data.memo as string) ?? '',
      })
    }))

    items.sort((a, b) => a.sortTime.getTime() - b.sortTime.getTime())
    allItems.value = items
  } catch (e) {
    console.error('[RecordsView] fetchDayRecords 오류:', e)
  } finally {
    loading.value = false
  }
}

watch(selectedDate, fetchDayRecords, { immediate: true })

// ── 카테고리별 카운트 ──
const allergyCount    = computed(() => allItems.value.filter(i => i.type === 'allergy').length)
const dietCount       = computed(() => allItems.value.filter(i => i.type === 'diet').length)
const medicationCount = computed(() => allItems.value.filter(i => i.type === 'medication').length)

// ── 필터링된 타임라인 ──
const filteredItems = computed(() => {
  if (activeCategory.value === 'all') return allItems.value
  return allItems.value.filter(i => i.type === activeCategory.value)
})

// ── 카드 메뉴 ──
const openMenuId = ref<string | null>(null)

function toggleMenu(id: string, e: Event) {
  e.stopPropagation()
  openMenuId.value = openMenuId.value === id ? null : id
}

function closeAllMenus() {
  openMenuId.value = null
}

// ── 삭제 확인 다이얼로그 ──
const deleteTargetItem = ref<TimelineItem | null>(null)

function requestDelete(item: TimelineItem, e: Event) {
  e.stopPropagation()
  closeAllMenus()
  deleteTargetItem.value = item
}

function cancelDelete() {
  deleteTargetItem.value = null
}

async function confirmDelete() {
  const item = deleteTargetItem.value
  if (!item) return
  deleteTargetItem.value = null
  const uid = authStore.user?.uid
  if (!uid) return
  const col = item.type === 'allergy'    ? 'allergyRecords'
            : item.type === 'diet'       ? 'dietRecords'
            :                              'medicationRecords'
  try {
    await deleteDoc(doc(db, 'users', uid, col, item.id))
    allItems.value = allItems.value.filter(i => i.id !== item.id)
  } catch (e) { console.error('삭제 오류', e) }
}

// ── 수정 ──
const showMedEditSheet = ref(false)
const editMedItem      = ref<TimelineItem | null>(null)

function handleEdit(item: TimelineItem) {
  closeAllMenus()
  const dateStr = fmtDateStr(selectedDate.value)
  if (item.type === 'allergy') {
    router.push(`/allergy-record?id=${item.id}&date=${dateStr}`)
  } else if (item.type === 'diet') {
    router.push(`/diet-record?id=${item.id}&date=${dateStr}`)
  } else if (item.type === 'medication') {
    editMedItem.value      = item
    showMedEditSheet.value = true
  }
}

function onMedEditSaved() {
  showMedEditSheet.value = false
  editMedItem.value      = null
  fetchDayRecords()
}

onMounted(() => {
  document.addEventListener('click', closeAllMenus)
  fetchMyAllergens()
})
onUnmounted(() => document.removeEventListener('click', closeAllMenus))

// ── 커스텀 캘린더 ──
const showCalendar   = ref(false)
const calViewYear    = ref(selectedDate.value.getFullYear())
const calViewMonth   = ref(selectedDate.value.getMonth()) // 0-indexed
const recordedDates  = ref<Set<string>>(new Set())

const CAL_DAYS = ['일', '월', '화', '수', '목', '금', '토']

const calMonthLabel = computed(() =>
  `${calViewYear.value}년 ${calViewMonth.value + 1}월`
)

const calCells = computed(() => {
  const y = calViewYear.value
  const m = calViewMonth.value
  const first = new Date(y, m, 1).getDay()
  const last  = new Date(y, m + 1, 0).getDate()
  const cells: Array<{ date: number | null; dateStr: string; isToday: boolean; isSelected: boolean; hasRecord: boolean; isSun: boolean; isSat: boolean }> = []
  for (let i = 0; i < first; i++) cells.push({ date: null, dateStr: '', isToday: false, isSelected: false, hasRecord: false, isSun: false, isSat: false })
  for (let d = 1; d <= last; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dow = new Date(y, m, d).getDay()
    cells.push({
      date: d, dateStr,
      isToday: dateStr === fmtDateStr(today),
      isSelected: dateStr === fmtDateStr(selectedDate.value),
      hasRecord: recordedDates.value.has(dateStr),
      isSun: dow === 0,
      isSat: dow === 6,
    })
  }
  return cells
})

async function fetchMonthRecords() {
  const uid = authStore.user?.uid
  if (!uid) return
  const y = calViewYear.value
  const m = calViewMonth.value
  const start = Timestamp.fromDate(new Date(y, m, 1))
  const end   = Timestamp.fromDate(new Date(y, m + 1, 1))
  const dates = new Set<string>()
  const toStr = (t: Timestamp) => {
    const d = t.toDate()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [aSnap, dSnap, mSnap] = await Promise.all([
    getDocs(query(collection(db, 'users', uid, 'allergyRecords'),    where('date',    '>=', start), where('date',    '<', end))),
    getDocs(query(collection(db, 'users', uid, 'dietRecords'),       where('date',    '>=', start), where('date',    '<', end))),
    getDocs(query(collection(db, 'users', uid, 'medicationRecords'), where('takenAt', '>=', start), where('takenAt', '<', end))),
  ])
  aSnap.forEach(d => dates.add(toStr(d.data().date as Timestamp)))
  dSnap.forEach(d => dates.add(toStr(d.data().date as Timestamp)))
  mSnap.forEach(d => dates.add(toStr(d.data().takenAt as Timestamp)))
  recordedDates.value = dates
}

function calPrevMonth() {
  if (calViewMonth.value === 0) { calViewYear.value--; calViewMonth.value = 11 }
  else calViewMonth.value--
  fetchMonthRecords()
}
function calNextMonth() {
  if (calViewMonth.value === 11) { calViewYear.value++; calViewMonth.value = 0 }
  else calViewMonth.value++
  fetchMonthRecords()
}
function calSelectDate(dateStr: string) {
  if (!dateStr) return
  const [y, m, d] = dateStr.split('-').map(Number)
  selectedDate.value = new Date(y, m - 1, d)
  showCalendar.value = false
}
function openCalendar() {
  calViewYear.value  = selectedDate.value.getFullYear()
  calViewMonth.value = selectedDate.value.getMonth()
  fetchMonthRecords()
  showCalendar.value = true
}
function closeCalendar() { showCalendar.value = false }

// ── 직전 식사 → 알러지 시간 Gap ──
interface MealGap {
  mealTypeLabel: string
  mealTypeEmoji: string
  diffText: string
}

function prevMealGap(item: TimelineItem): MealGap | null {
  if (item.type !== 'allergy') return null

  // allItems(전체, 필터 무관)에서 이 알러지 직전의 마지막 식단 기록 탐색
  const prevDiet = allItems.value
    .filter(i => i.type === 'diet' && i.sortTime.getTime() < item.sortTime.getTime())
    .sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime())[0]

  if (!prevDiet) return null

  const diffMin = Math.round(
    (item.sortTime.getTime() - prevDiet.sortTime.getTime()) / 60_000
  )
  if (diffMin <= 0) return null

  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  const diffText = h === 0
    ? `${m}분 후`
    : m === 0
      ? `${h}시간 후`
      : `${h}시간 ${m}분 후`

  return {
    mealTypeLabel: MEAL_TYPE_LABEL[prevDiet.mealType ?? ''] ?? '식사',
    mealTypeEmoji: MEAL_TYPE_EMOJI[prevDiet.mealType ?? ''] ?? '🍽️',
    diffText,
  }
}

// ── 알러지 이벤트 직전 약 복용 연동 표시 ──
// 약 복용 카드의 30분 이내 이전에 알러지 기록이 있으면 연동 표시
function linkedAllergyTime(item: TimelineItem): string | null {
  if (item.type !== 'medication') return null
  const medTime = item.sortTime.getTime()
  const found = allItems.value.find(i =>
    i.type === 'allergy' &&
    medTime - i.sortTime.getTime() >= 0 &&
    medTime - i.sortTime.getTime() <= 30 * 60 * 1000
  )
  return found ? found.timeStr : null
}

function intensityLabel(v?: number): string {
  if (!v) return ''
  if (v <= 3) return '약함'
  if (v <= 6) return '보통'
  return '심함'
}

function intensityClass(v?: number): string {
  if (!v) return ''
  if (v <= 3) return 'rv-intensity-mild'
  if (v <= 6) return 'rv-intensity-moderate'
  return 'rv-intensity-severe'
}
</script>

<template>
  <AppHeader :tabs="NAV_TABS" v-model:activeTab="activeTab" />

  <div class="rv-page">

    <!-- ── 날짜 필터 ── -->
    <div class="rv-date-nav">
      <button class="rv-date-arrow" type="button" aria-label="이전 날" @click="prevDay">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path d="M7 1L1 7l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <button class="rv-date-label-btn" type="button" aria-label="날짜 선택" @click="openCalendar">
        <span class="rv-date-label">{{ selectedDateLabel }}</span>
        <svg class="rv-date-cal-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>

      <!-- 커스텀 캘린더 드롭다운 -->
      <Teleport to="body">
        <div v-if="showCalendar" class="rv-cal-backdrop" @click.self="closeCalendar">
          <div class="rv-cal-panel">
            <!-- 헤더 -->
            <div class="rv-cal-header">
              <button class="rv-cal-nav-btn" type="button" @click="calPrevMonth">
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M6 1L1 6l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <span class="rv-cal-month-label">{{ calMonthLabel }}</span>
              <button class="rv-cal-nav-btn" type="button" @click="calNextMonth">
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none"><path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>

            <!-- 요일 헤더 -->
            <div class="rv-cal-week-row">
              <span v-for="d in CAL_DAYS" :key="d" class="rv-cal-week-cell" :class="{ 'rv-cal-sun': d === '일', 'rv-cal-sat': d === '토' }">{{ d }}</span>
            </div>

            <!-- 날짜 그리드 -->
            <div class="rv-cal-grid">
              <button
                v-for="(cell, ci) in calCells"
                :key="ci"
                class="rv-cal-cell"
                :class="{
                  'rv-cal-cell--empty': !cell.date,
                  'rv-cal-cell--today': cell.isToday,
                  'rv-cal-cell--selected': cell.isSelected,
                  'rv-cal-cell--has-record': cell.hasRecord,
                  'rv-cal-cell--sun': cell.isSun,
                  'rv-cal-cell--sat': cell.isSat,
                }"
                type="button"
                :disabled="!cell.date"
                @click="calSelectDate(cell.dateStr)"
              >
                <span v-if="cell.date" class="rv-cal-day">{{ cell.date }}</span>
                <span v-if="cell.hasRecord && !cell.isSelected" class="rv-cal-dot"></span>
              </button>
            </div>

            <!-- 오늘로 -->
            <div class="rv-cal-footer">
              <button class="rv-cal-today-btn" type="button" @click="calSelectDate(fmtDateStr(today))">오늘</button>
            </div>
          </div>
        </div>
      </Teleport>

      <button class="rv-date-arrow" type="button" aria-label="다음 날" @click="nextDay">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path d="M1 1l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <!-- ── 카테고리 필터 칩 ── -->
    <div class="rv-chips">
      <button
        class="rv-chip"
        :class="{ active: activeCategory === 'all' }"
        type="button"
        @click="activeCategory = 'all'"
      >전체</button>
      <button
        class="rv-chip rv-chip-allergy"
        :class="{ active: activeCategory === 'allergy' }"
        type="button"
        @click="activeCategory = 'allergy'"
      >🚨 알러지 {{ allergyCount }}회</button>
      <button
        class="rv-chip rv-chip-diet"
        :class="{ active: activeCategory === 'diet' }"
        type="button"
        @click="activeCategory = 'diet'"
      >🥗 식단 {{ dietCount }}회</button>
      <button
        class="rv-chip rv-chip-med"
        :class="{ active: activeCategory === 'medication' }"
        type="button"
        @click="activeCategory = 'medication'"
      >💊 복약 {{ medicationCount }}회</button>
    </div>

    <!-- ── 타임라인 ── -->
    <div class="rv-timeline">

      <!-- 로딩 -->
      <div v-if="loading" class="rv-empty">
        <span class="rv-spinner"></span>
        <span>기록 불러오는 중…</span>
      </div>

      <!-- 기록 없음 -->
      <div v-else-if="filteredItems.length === 0" class="rv-empty">
        <span class="rv-empty-icon">📭</span>
        <span>이 날의 기록이 없어요</span>
      </div>

      <!-- 타임라인 아이템 -->
      <div v-else class="rv-tl-list">
        <div
          v-for="(item, i) in filteredItems"
          :key="item.id"
          class="rv-tl-row"
        >
          <!-- 왼쪽: 시간 + 점 + 선 -->
          <div class="rv-tl-time">{{ item.timeStr }}</div>
          <div class="tl-connector">
            <div v-if="i > 0" class="tl-line-pre"></div>
            <div
              class="tl-dot"
              :class="[item.type === 'diet' ? `tl-dot-diet--${item.mealType ?? 'snack'}` : `tl-dot-${item.type}`, { 'tl-dot-first': i === 0 }]"
            ></div>
            <div v-if="i < filteredItems.length - 1" class="tl-line-post"></div>
          </div>

          <!-- 오른쪽: 카드 -->
          <div class="rv-tl-card" :class="[`rv-card-${item.type}`, item.type === 'diet' ? `rv-card-diet--${item.mealType ?? 'snack'}` : '']">

            <!-- 카드 메뉴 -->
            <div class="rv-card-menu-wrap" @click.stop>
              <button
                class="rv-card-menu-btn"
                type="button"
                aria-label="더보기"
                @click="toggleMenu(item.id, $event)"
              >⋮</button>
              <Transition name="rv-menu">
                <div v-if="openMenuId === item.id" class="rv-card-menu-dropdown">
                  <button class="rv-card-menu-item" type="button" @click="handleEdit(item)">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    </svg>
                    수정
                  </button>
                  <button class="rv-card-menu-item rv-card-menu-delete" type="button" @click="requestDelete(item, $event)">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 4h10M5 4V2h4v2M5.5 6.5v4M8.5 6.5v4M3 4l.8 8h6.4L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    삭제
                  </button>
                </div>
              </Transition>
            </div>

            <!-- 알러지 카드 -->
            <template v-if="item.type === 'allergy'">

              <!-- ① 상단 히어로 영역 -->
              <div class="rv-al-hero" :class="intensityClass(item.intensity)">
                <div class="rv-al-hero-left">
                  <span class="rv-al-hero-icon">🚨</span>
                  <div>
                    <p class="rv-al-hero-title">알러지 발생</p>
                    <p v-if="item.intensity" class="rv-al-hero-sub">
                      {{ intensityLabel(item.intensity) }} 강도
                    </p>
                  </div>
                </div>
                <div v-if="item.intensity" class="rv-al-hero-score">
                  <span class="rv-al-hero-score-num">{{ item.intensity }}</span>
                  <span class="rv-al-hero-score-den">/10</span>
                </div>
              </div>

              <!-- ② 강도 바 -->
              <div v-if="item.intensity" class="rv-al-bar-row">
                <div class="rv-al-bar-track">
                  <div
                    class="rv-al-bar-fill"
                    :class="intensityClass(item.intensity)"
                    :style="{ width: `${(item.intensity / 10) * 100}%` }"
                  ></div>
                </div>
              </div>

              <!-- ③ 증상 / 발생 부위 -->
              <div v-if="item.symptoms?.length || item.bodyParts?.length" class="rv-al-body">
                <div v-if="item.symptoms?.length" class="rv-al-section">
                  <p class="rv-al-section-label">증상</p>
                  <div class="rv-al-chips">
                    <span v-for="s in item.symptoms" :key="s" class="rv-tag rv-tag-symptom">{{ SYMPTOM_LABEL[s] ?? s }}</span>
                  </div>
                </div>
                <div v-if="item.bodyParts?.length" class="rv-al-section">
                  <p class="rv-al-section-label">발생 부위</p>
                  <div class="rv-al-chips">
                    <span v-for="b in item.bodyParts" :key="b" class="rv-tag rv-tag-body">{{ BODY_PART_LABEL[b] ?? b }}</span>
                  </div>
                </div>
              </div>

              <!-- ④ 메모 -->
              <p v-if="item.memo" class="rv-memo rv-al-memo">{{ item.memo }}</p>

              <!-- ⑤ Gap 인디케이터 -->
              <div v-if="prevMealGap(item)" class="rv-meal-gap">
                <span class="rv-meal-gap-emoji">{{ prevMealGap(item)!.mealTypeEmoji }}</span>
                <span class="rv-meal-gap-text">
                  {{ prevMealGap(item)!.mealTypeLabel }} 식사 후
                  <strong>{{ prevMealGap(item)!.diffText }}</strong>에 발생
                </span>
              </div>

            </template>

            <!-- 식단 카드 -->
            <template v-else-if="item.type === 'diet'">

              <!-- ① 히어로 -->
              <div class="rv-diet-hero" :class="`rv-diet-hero--${item.mealType ?? 'snack'}`">
                <div class="rv-diet-hero-left">
                  <span class="rv-diet-hero-icon">{{ MEAL_TYPE_EMOJI[item.mealType ?? ''] ?? '🥗' }}</span>
                  <div>
                    <p class="rv-diet-hero-title">식단 기록</p>
                    <p class="rv-diet-hero-sub">{{ MEAL_TYPE_LABEL[item.mealType ?? ''] ?? '식사' }}</p>
                  </div>
                </div>
                <span class="rv-diet-hero-count">
                  {{ item.foodItems?.length ?? 0 }}가지
                </span>
              </div>

              <!-- ② 음식 목록 -->
              <div v-if="item.foodItems?.length" class="rv-diet-body">
                <div
                  v-for="(food, fi) in item.foodItems"
                  :key="fi"
                  class="rv-diet-food-item"
                  :class="{ 'rv-diet-food-item--last': fi === (item.foodItems?.length ?? 0) - 1 }"
                >
                  <div class="rv-diet-food-row">
                    <span class="rv-diet-food-dot"></span>
                    <span class="rv-diet-food-name">{{ food.name }}</span>
                    <span class="rv-diet-food-amount">× {{ food.amount }}</span>
                  </div>
                  <div v-if="food.allergens?.length" class="rv-allergen-chips rv-diet-allergen-chips">
                    <template v-for="code in food.allergens" :key="code">
                      <span
                        v-if="allergenMap.get(code)"
                        class="rv-allergen-chip"
                        :class="{ 'rv-allergen-chip--mine': myAllergens.includes(code) }"
                      >{{ allergenMap.get(code)!.emoji }} {{ allergenMap.get(code)!.name_ko }}</span>
                    </template>
                  </div>
                </div>
              </div>

              <!-- ③ 메모 -->
              <div v-if="item.memo" class="rv-diet-memo-wrap">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 2h8v7H2zM4 5h4M4 7h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <p class="rv-diet-memo">{{ item.memo }}</p>
              </div>

            </template>

            <!-- 약 복용 카드 -->
            <template v-else-if="item.type === 'medication'">
              <!-- 히어로 -->
              <div class="rv-med-hero">
                <div class="rv-med-hero-left">
                  <span class="rv-med-hero-icon">{{ MED_EMOJI[item.medicationType ?? ''] ?? '💊' }}</span>
                  <div>
                    <p class="rv-med-hero-title">복약 완료</p>
                    <p class="rv-med-hero-sub">{{ MED_LABEL[item.medicationType ?? ''] ?? '기타' }}</p>
                  </div>
                </div>
              </div>

              <!-- 약품 정보 바디 -->
              <div class="rv-med-body">
                <div class="rv-med-info-row">
                  <span class="rv-med-info-label">약품명</span>
                  <span class="rv-med-info-value">{{ item.medicationNickname || '(이름 없음)' }}</span>
                </div>
                <div v-if="item.medicationType" class="rv-med-info-row">
                  <span class="rv-med-info-label">제형</span>
                  <span class="rv-med-info-value rv-med-type-chip">
                    {{ MED_EMOJI[item.medicationType] ?? '💊' }} {{ MED_LABEL[item.medicationType] ?? item.medicationType }}
                  </span>
                </div>
              </div>

              <!-- 알러지 연동 -->
              <p v-if="linkedAllergyTime(item)" class="rv-med-linked">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {{ linkedAllergyTime(item) }} 알러지 증상 후 복용
              </p>

              <!-- 메모 -->
              <div v-if="item.memo" class="rv-med-memo-wrap">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
                <p class="rv-med-memo">{{ item.memo }}</p>
              </div>
            </template>

          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 약 복용 수정 시트 ── -->
  <MedicationIntakeSheet
    :visible="showMedEditSheet"
    :edit-record-id="editMedItem?.id ?? null"
    :edit-medication-id="editMedItem?.medicationId ?? null"
    :edit-taken-at="editMedItem ? editMedItem.sortTime : null"
    @close="showMedEditSheet = false; editMedItem = null"
    @saved="onMedEditSaved"
  />

  <!-- ── 삭제 확인 다이얼로그 ── -->
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="deleteTargetItem"
        class="rd-backdrop del-backdrop"
        role="alertdialog"
        aria-modal="true"
        aria-label="삭제 확인"
        @click.self="cancelDelete"
      >
        <div class="rd-sheet del-sheet">
          <div class="del-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="13" fill="rgba(220,53,69,0.10)" stroke="#dc3545" stroke-width="1.5"/>
              <path d="M14 8v7" stroke="#dc3545" stroke-width="2.2" stroke-linecap="round"/>
              <circle cx="14" cy="19.5" r="1.2" fill="#dc3545"/>
            </svg>
          </div>
          <p class="del-title">정말 삭제하시겠습니까?</p>
          <p class="del-desc">삭제된 기록은 복구할 수 없습니다.</p>
          <div class="del-btns">
            <button type="button" class="del-btn del-btn-cancel" @click="cancelDelete">취소</button>
            <button type="button" class="del-btn del-btn-ok" @click="confirmDelete">삭제</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>


