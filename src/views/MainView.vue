<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { signOut } from 'firebase/auth'
import { auth } from '@/firebase'
import { useAuthStore } from '@/stores/auth'

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

// ── 날짜 헤더 ──
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']
const now    = new Date()
const greetingDate = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${DAY_KO[now.getDay()]}요일`

// ── 캘린더 ──
const HOLIDAYS: Record<number, Record<string, string>> = {
  2024: {
    '1-1':'신정','2-9':'설날연휴','2-10':'설날','2-11':'설날연휴','2-12':'대체공휴일',
    '3-1':'삼일절','4-10':'국회의원선거일','5-5':'어린이날','5-15':'부처님오신날',
    '6-6':'현충일','8-15':'광복절','9-16':'추석연휴','9-17':'추석','9-18':'추석연휴',
    '10-3':'개천절','10-9':'한글날','12-25':'성탄절'
  },
  2025: {
    '1-1':'신정','1-28':'설날연휴','1-29':'설날','1-30':'설날연휴',
    '3-1':'삼일절','5-5':'어린이날','5-6':'대체공휴일','5-15':'부처님오신날',
    '6-6':'현충일','8-15':'광복절',
    '10-3':'개천절','10-5':'추석연휴','10-6':'추석','10-7':'추석연휴',
    '10-9':'한글날','12-25':'성탄절'
  },
  2026: {
    '1-1':'신정','2-15':'설날연휴','2-16':'설날','2-17':'설날연휴',
    '3-1':'삼일절','5-5':'어린이날','5-24':'부처님오신날',
    '6-6':'현충일','8-15':'광복절',
    '9-23':'추석연휴','9-24':'추석','9-25':'추석연휴',
    '10-3':'개천절','10-9':'한글날','12-25':'성탄절'
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
}

const today        = new Date()
const currentYear  = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())
const activeTab    = ref<'home' | 'records' | 'stats'>('home')

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
    const dateStr     = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ empty: false, date: d, dateStr, isToday, isRed, isBlue, holidayName })
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
  currentYear.value  = new Date().getFullYear()
  currentMonth.value = new Date().getMonth()
}

// ── 기록 추가 다이얼로그 ──
const showDialog = ref(false)

function openDialog()  { showDialog.value = true }
function closeDialog() { showDialog.value = false }

function selectRecord(type: 'allergy' | 'diet') {
  closeDialog()
  // TODO: 기록 입력 폼으로 연결
  console.log('선택한 기록 타입:', type)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showDialog.value) closeDialog()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Nav -->
  <nav>
    <div class="nav-inner">
      <a href="#" class="nav-logo">
        <span class="logo-badge">A</span>
        <span class="logo-wordmark">Check</span>
      </a>
      <div class="nav-tabs">
        <button class="nav-tab" :class="{ active: activeTab === 'home' }"    @click="activeTab = 'home'">홈</button>
        <button class="nav-tab" :class="{ active: activeTab === 'records' }" @click="activeTab = 'records'">기록</button>
        <button class="nav-tab" :class="{ active: activeTab === 'stats' }"   @click="activeTab = 'stats'">통계</button>
      </div>
      <div class="nav-user">
        <div class="user-chip">
          <div class="user-avatar">
            <img v-if="user?.photoURL" :src="user.photoURL" :alt="userName" style="display:block">
            <span v-else>{{ userInitial }}</span>
          </div>
          <span class="user-chip-name">{{ userName }}</span>
        </div>
        <button class="btn-logout-sm" type="button" @click="handleLogout">로그아웃</button>
      </div>
    </div>
  </nav>

  <!-- Page Body -->
  <div class="page-body">
    <!-- Greeting -->
    <div class="page-greeting">
      <div>
        <p class="greeting-date">{{ greetingDate }}</p>
        <h1 class="greeting-title">
          안녕하세요, <span class="name-highlight">{{ userName }}</span>님 👋
        </h1>
      </div>

      <!-- 데스크톱 전용 버튼 -->
      <button class="btn-add-record btn-add-desktop" type="button" @click="openDialog">
        <span class="btn-add-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="btn-add-label">기록 추가</span>
      </button>
    </div>

    <!-- 모바일 전용: 스탯 카드 위 우측 정렬 소형 버튼 -->
    <div class="stats-bar">
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
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon-wrap pink">🤧</div>
        <div class="stat-body">
          <div class="stat-num"><span>0</span><span class="stat-unit">회</span></div>
          <div class="stat-label">이번 달 알러지</div>
          <div class="stat-trend"></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrap green">🥗</div>
        <div class="stat-body">
          <div class="stat-num"><span>0</span><span class="stat-unit">회</span></div>
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
          :class="{ empty: cell.empty }"
          :data-date="cell.dateStr"
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
            <div class="cal-dots"></div>
          </template>
        </div>
      </div>
    </div>
  </div>

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
              <p class="rd-eyebrow">{{ greetingDate }}</p>
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
                <span class="rd-option-desc">증상, 원인 음식, 반응 정도를 기록해요</span>
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
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ════════════════════════════════
   기록 추가 버튼
   ════════════════════════════════ */
.btn-add-record {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 0 22px 0 16px;
  height: 46px;
  background: linear-gradient(135deg, #f4a7bb 0%, #e8879f 100%);
  border: none;
  border-radius: 100px;
  color: #fff;
  font-family: 'Noto Sans KR', sans-serif;
  cursor: pointer;
  white-space: nowrap;
  position: relative;
  overflow: hidden;
  box-shadow:
    0 2px 12px rgba(232, 135, 159, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  transition: box-shadow 0.3s ease, filter 0.3s ease;
}

/* 광택 레이어 — 평소에는 고정 */
.btn-add-record::before {
  content: '';
  position: absolute;
  top: 0;
  left: -80%;
  width: 55%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  transform: skewX(-18deg);
  transition: left 0.55s ease;
  pointer-events: none;
}

/* hover: 광택이 왼쪽→오른쪽으로 훑고 지나감 */
.btn-add-record:hover::before {
  left: 135%;
}

.btn-add-record:hover {
  filter: brightness(1.06);
  box-shadow:
    0 4px 20px rgba(232, 135, 159, 0.48),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.btn-add-record:active {
  filter: brightness(0.97);
  box-shadow:
    0 1px 6px rgba(232, 135, 159, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition-duration: 0.08s;
}

.btn-add-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.20);
  border: 1px solid rgba(255, 255, 255, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-add-label {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1px;
  line-height: 1;
}

/* 데스크톱: 모바일 행 숨김 */
.stats-bar { display: none; }

@media (max-width: 640px) {
  /* 인사말 영역의 데스크톱 버튼 숨김 */
  .btn-add-desktop { display: none !important; }

  /* margin-bottom 제거 */
  .page-greeting { margin-bottom: 2px !important; }

  /* 모바일 버튼 행: 스탯 카드 바로 위 우측 정렬 */
  .stats-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  /* 소형 알약 버튼 */
  .btn-add-mobile {
    height: 32px;
    padding: 0 12px 0 8px;
    gap: 6px;
    border-radius: 100px;
    width: auto;
  }
  .btn-add-mobile .btn-add-icon {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.20);
    border: 1px solid rgba(255, 255, 255, 0.28);
  }
  .btn-add-mobile .btn-add-label {
    display: flex;
    font-size: 12px;
    font-weight: 700;
  }
}


/* ════════════════════════════════
   기록 추가 다이얼로그
   ════════════════════════════════ */
.rd-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 10, 0.48);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 500;
  display: flex;
  align-items: flex-end;         /* 바텀시트 */
  justify-content: center;
  padding: 0 0 env(safe-area-inset-bottom, 0);
}

@media (min-width: 640px) {
  .rd-backdrop {
    align-items: center;         /* 데스크톱: 중앙 */
    padding: 24px;
  }
}

.rd-sheet {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 28px 28px 0 0;
  padding: 12px 24px 36px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

@media (min-width: 640px) {
  .rd-sheet {
    border-radius: 28px;
    padding: 28px 28px 32px;
  }
  .rd-handle { display: none; }
}

/* 핸들바 */
.rd-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: #e8e8e8;
  margin: 0 auto 20px;
  flex-shrink: 0;
}

/* 헤더 */
.rd-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.rd-eyebrow {
  font-size: 12px;
  color: #bbb;
  font-weight: 500;
  margin: 0 0 4px;
  letter-spacing: 0.1px;
}

.rd-title {
  font-size: 20px;
  font-weight: 800;
  color: #111;
  margin: 0;
  letter-spacing: -0.4px;
  line-height: 1.3;
}

.rd-close {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: #f4f4f4;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 2px;
  transition: background 0.18s, color 0.18s;
}
.rd-close:hover { background: #ebebeb; color: #333; }

/* 선택 카드 목록 */
.rd-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rd-option {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 18px 16px 18px 18px;
  border: 1.5px solid #f0f0f0;
  border-radius: 18px;
  background: #fafafa;
  cursor: pointer;
  font-family: 'Noto Sans KR', sans-serif;
  text-align: left;
  transition: border-color 0.2s, background 0.2s, transform 0.18s ease, box-shadow 0.2s;
  position: relative;
  overflow: hidden;
}

.rd-option:hover {
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.07);
}

.rd-option:active {
  transform: translateY(0);
  box-shadow: none;
  transition-duration: 0.08s;
}

/* 알러지 카드 hover 색상 */
.rd-option.allergy:hover { border-color: rgba(232, 135, 159, 0.45); }
.rd-option.allergy:hover .rd-option-title { color: #e8879f; }

/* 식단 카드 hover 색상 */
.rd-option.diet:hover { border-color: rgba(74, 222, 128, 0.50); }
.rd-option.diet:hover .rd-option-title { color: #22c55e; }

/* 아이콘 */
.rd-option-icon {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}
.rd-option-icon.allergy { background: #FEF0F4; }
.rd-option-icon.diet    { background: #f0fdf4; }

/* 텍스트 */
.rd-option-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rd-option-title {
  font-size: 15px;
  font-weight: 700;
  color: #111;
  transition: color 0.2s;
}

.rd-option-desc {
  font-size: 12.5px;
  color: #aaa;
  font-weight: 400;
  line-height: 1.4;
}

/* 화살표 */
.rd-option-arrow {
  color: #ccc;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color 0.2s, transform 0.2s;
}

.rd-option:hover .rd-option-arrow {
  transform: translateX(3px);
  color: #aaa;
}


/* ════════════════════════════════
   다이얼로그 Transition
   ════════════════════════════════ */
.dialog-enter-active {
  transition: opacity 0.22s ease;
}
.dialog-leave-active {
  transition: opacity 0.18s ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

/* 시트 자체 애니메이션 */
.dialog-enter-active .rd-sheet {
  animation: sheetSlideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.dialog-leave-active .rd-sheet {
  animation: sheetSlideDown 0.18s ease forwards;
}

@keyframes sheetSlideUp {
  from { transform: translateY(32px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes sheetSlideDown {
  from { transform: translateY(0);    opacity: 1; }
  to   { transform: translateY(24px); opacity: 0; }
}

@media (min-width: 640px) {
  .dialog-enter-active .rd-sheet {
    animation: sheetScaleIn 0.26s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dialog-leave-active .rd-sheet {
    animation: sheetScaleOut 0.18s ease forwards;
  }
  @keyframes sheetScaleIn {
    from { transform: scale(0.95) translateY(8px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);   opacity: 1; }
  }
  @keyframes sheetScaleOut {
    from { transform: scale(1)    translateY(0);   opacity: 1; }
    to   { transform: scale(0.96) translateY(4px); opacity: 0; }
  }
}
</style>
