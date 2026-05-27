<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { httpsCallable } from 'firebase/functions'
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { functions, db } from '@/firebase'
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'

const router    = useRouter()
const route     = useRoute()
const authStore = useAuthStore()

// ── 날짜 파싱 ──────────────────────────────────────────────
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

// ── 식사 타입 ──────────────────────────────────────────────
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

interface MealTab {
  key:   MealType
  label: string
  emoji: string
  color: string      // accent color for active state
  bg:    string      // gradient bg for active state
}

const MEAL_TABS: MealTab[] = [
  { key: 'breakfast', label: '아침', emoji: '🌅', color: '#F4845F', bg: 'linear-gradient(135deg,#FFF3EE 0%,#FFF8F5 100%)' },
  { key: 'lunch',     label: '점심', emoji: '☀️', color: '#E8A020', bg: 'linear-gradient(135deg,#FFFBEE 0%,#FFFDF5 100%)' },
  { key: 'dinner',    label: '저녁', emoji: '🌙', color: '#7B6FE8', bg: 'linear-gradient(135deg,#F4F3FF 0%,#F9F8FF 100%)' },
  { key: 'snack',     label: '간식', emoji: '🍪', color: '#E8879F', bg: 'linear-gradient(135deg,#FEF0F4 0%,#FFF5F8 100%)' },
]

/** 현재 시각을 기준으로 기본 식사 종류를 반환 */
function getDefaultMeal(): MealType {
  const now = new Date()
  const t   = now.getHours() * 60 + now.getMinutes() // 자정 기준 분(分)

  if (t >=  6 * 60 && t <=  9 * 60 + 59) return 'breakfast' //  6:00 ~ 9:59
  if (t >= 11 * 60 && t <= 14 * 60 + 59) return 'lunch'      // 11:00 ~ 14:59
  if (t >= 17 * 60 && t <= 20 * 60)      return 'dinner'     // 17:00 ~ 20:00
  return 'snack'                                               // 그 외 (20:01~)
}

const selectedMeal = ref<MealType>(getDefaultMeal())
const activeMeal = computed(() => MEAL_TABS.find(t => t.key === selectedMeal.value)!)

// ── 식사 시간 ───────────────────────────────────────────────────
const now = new Date()
const selectedTime = ref<string>(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)

// ── 음식 항목 ──────────────────────────────────────────────
interface FoodItem {
  id:        number
  name:      string
  amount:    number
  allergens?: string[]
  calories?:  number | null
  category?:  string
  food_code?: string
}

interface SearchResult {
  food_code:   string
  food_name:   string
  category:    string
  maker:       string
  allergens:   string[]
  img_url?:    string
  img_url2?:   string
  nutrition: {
    calories_kcal:  number | null
    carbs_g:        number | null
    protein_g:      number | null
    fat_g:          number | null
    sodium_mg:      number | null
    sugar_g:        number | null
    fiber_g:        number | null
    cholesterol_mg: number | null
    sat_fat_g:      number | null
  }
}

let nextId = 1
const foodItems = ref<FoodItem[]>([])

function removeFood(id: number) {
  foodItems.value = foodItems.value.filter(f => f.id !== id)
}

function addFoodManual() {
  foodItems.value.push({ id: nextId++, name: '', amount: 1 })
}

/** 스테퍼 +/- */
function changeAmount(item: FoodItem, delta: number) {
  item.amount = Math.max(1, item.amount + delta)
}

/** 직접 입력 시 유효값 보정 (소수·음수·비어있으면 1로) */
function clampAmount(item: FoodItem) {
  const v = Math.floor(Number(item.amount))
  item.amount = isNaN(v) || v < 1 ? 1 : v
}

// ── 식품 검색 ──────────────────────────────────────────────
const searchQuery   = ref('')
const searchResults = ref<SearchResult[]>([])
const searchLoading = ref(false)
const searchError   = ref('')

async function doSearch() {
  const query = searchQuery.value.trim()
  if (query.length < 2) {
    searchResults.value = []
    return
  }
  searchLoading.value = true
  searchError.value   = ''
  try {
    const fn = httpsCallable<{ query: string }, { source: string; results: SearchResult[] }>(
      functions, 'searchFood'
    )
    const { data } = await fn({ query })
    searchResults.value = data.results
    if (data.results.length === 0) {
      searchError.value = '검색 결과가 없습니다.'
    }
  } catch (err: any) {
    console.error('[searchFood] 오류:', err)
    const msg: string = err?.message ?? ''
    if (msg.includes('unauthenticated') || msg.includes('로그인')) {
      searchError.value = '로그인이 필요합니다.'
    } else if (msg.includes('unavailable') || msg.includes('fetch')) {
      searchError.value = '서버에 연결할 수 없습니다. 에뮬레이터가 실행 중인지 확인해주세요.'
    } else {
      searchError.value = `검색 중 오류가 발생했습니다: ${msg || '알 수 없는 오류'}`
    }
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

function addFoodFromResult(result: SearchResult) {
  // 동일한 food_code가 이미 목록에 있으면 수량만 +1
  const existing = foodItems.value.find(f => f.food_code && f.food_code === result.food_code)
  if (existing) {
    existing.amount += 1
    clearSearch()
    return
  }

  foodItems.value.push({
    id:        nextId++,
    name:      result.food_name,
    amount:    1,
    allergens: result.allergens,
    calories:  result.nutrition.calories_kcal,
    category:  result.category,
    food_code: result.food_code,
  })
  clearSearch()
}

function clearSearch() {
  searchQuery.value   = ''
  searchResults.value = []
  searchLoading.value = false
  searchError.value   = ''
}

// ── 메모 ───────────────────────────────────────────────────
const memo     = ref('')
const MEMO_MAX = 300

// ── 제출 ───────────────────────────────────────────────────
const errorMsg    = ref('')
const isSubmitting = ref(false)

function validate(): boolean {
  if (!foodItems.value.some(f => f.name.trim())) {
    errorMsg.value = '음식 이름을 최소 한 가지 입력해주세요.'
    return false
  }
  errorMsg.value = ''
  return true
}

async function handleSubmit() {
  if (!validate()) return
  isSubmitting.value = true
  errorMsg.value = ''

  try {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('로그인이 필요합니다.')

    // dateParam(YYYY-MM-DD) & selectedTime(HH:mm) → 해당 날짜/시간 Timestamp
    const [year, month, day] = dateParam.value.split('-').map(Number)
    const [hour, minute] = selectedTime.value.split(':').map(Number)
    const dateTimestamp = Timestamp.fromDate(new Date(year, month - 1, day, hour, minute))

    const foods = foodItems.value
      .filter(f => f.name.trim())
      .map(f => ({
        name:          f.name.trim(),
        amount:        f.amount,
        food_code:     f.food_code  ?? null,
        allergens:     f.allergens  ?? null,
        calories_kcal: f.calories   ?? null,
        category:      f.category   ?? null,
      }))

    await addDoc(collection(db, 'users', uid, 'dietRecords'), {
      uid,
      date:      dateTimestamp,
      mealType:  selectedMeal.value,
      foods,
      memo:      memo.value.trim(),
      createdAt: serverTimestamp(),
    })

    // 저장 성공 → 홈으로 이동 전 isSubmitting 해제 (unmount 경고 방지)
    isSubmitting.value = false
    router.push('/')
  } catch (e: any) {
    console.error('[dietRecord] 저장 오류:', e)
    const msg: string = e?.message ?? ''
    if (msg.includes('로그인')) {
      errorMsg.value = '로그인이 필요합니다. 다시 로그인 후 시도해주세요.'
    } else if (msg.includes('permission') || msg.includes('Missing or insufficient')) {
      errorMsg.value = '저장 권한이 없습니다. 잠시 후 다시 시도해주세요.'
    } else {
      errorMsg.value = '저장 중 오류가 발생했습니다. 다시 시도해주세요.'
    }
    isSubmitting.value = false
  }
}

// ── 식사 종류 툴팁 ─────────────────────────────────────────
const showMealTooltip = ref(false)

function closeMealTooltip() { showMealTooltip.value = false }
function handleDocumentClick() { closeMealTooltip() }
onMounted(()  => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))

// ── 알레르기 코드 → 표시명 변환 ───────────────────────────────
const ALLERGEN_LABEL: Record<string, string> = {
  EGG:       '달걀(난류)',
  MILK:      '우유',
  PEANUT:    '땅콩',
  WALNUT:    '호두',
  PINE_NUT:  '잣',
  WHEAT:     '밀',
  SOY:       '대두(콩)',
  BUCKWHEAT: '메밀',
  SHRIMP:    '새우',
  CRAB:      '게',
  SQUID:     '오징어',
  MACKEREL:  '고등어',
  SHELLFISH: '조개류',
  OYSTER:    '굴',
  ABALONE:   '전복',
  MUSSEL:    '홍합',
  PORK:      '돼지고기',
  BEEF:      '소고기',
  CHICKEN:   '닭고기',
  PEACH:     '복숭아',
  TOMATO:    '토마토',
  SULFITE:   '아황산류',
}

/** 코드값이면 한글명으로, 미매칭 원문이면 그대로 반환 */
function allergenLabel(code: string): string {
  return ALLERGEN_LABEL[code] ?? code
}

// ── 뒤로가기 ───────────────────────────────────────────────
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<template>
  <AppHeader pageTitle="식단 기록" />

  <div class="page-body diet-page">

    <!-- ── 히어로 헤더 ── -->
    <div class="diet-hero">
      <button class="btn-back" type="button" aria-label="뒤로가기" @click="goBack">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div class="diet-hero-body">
        <span class="diet-hero-badge">🥗 식단 기록</span>
        <h1 class="diet-hero-title">오늘 뭐 드셨나요?</h1>
        <div class="diet-hero-date">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>{{ dateParts.y }}년 {{ dateParts.m }}월 {{ dateParts.d }}일 {{ dateParts.dowLabel }}</span>
        </div>
      </div>

      <!-- 데코 원 -->
      <div class="diet-hero-deco" aria-hidden="true"></div>
    </div>

    <!-- ── 폼 ── -->
    <form class="diet-form" @submit.prevent="handleSubmit">

      <!-- 식사 종류 -->
      <div class="diet-section">
        <div class="diet-section-label">
          <span class="diet-section-dot"></span>
          식사 종류
          <!-- 툴팁 트리거 -->
          <button
            class="meal-info-btn"
            :class="{ active: showMealTooltip }"
            type="button"
            aria-label="식사 시간대 안내"
            :aria-expanded="showMealTooltip"
            @click.stop="showMealTooltip = !showMealTooltip"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 5.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="6" cy="3.5" r="0.7" fill="currentColor"/>
            </svg>
          </button>
          <!-- 툴팁 패널 -->
          <Transition name="tooltip-fade">
            <div v-if="showMealTooltip" class="meal-tooltip" role="tooltip" @click.stop>
              <p class="meal-tooltip-title">시간대별 자동 선택</p>
              <ul class="meal-tooltip-list">
                <li>
                  <span class="tl-emoji">🌅</span>
                  <span class="tl-name">아침</span>
                  <span class="tl-time">6시 ~ 9시</span>
                </li>
                <li>
                  <span class="tl-emoji">☀️</span>
                  <span class="tl-name">점심</span>
                  <span class="tl-time">11시 ~ 14시</span>
                </li>
                <li>
                  <span class="tl-emoji">🌙</span>
                  <span class="tl-name">저녁</span>
                  <span class="tl-time">17시 ~ 20시</span>
                </li>
                <li>
                  <span class="tl-emoji">🍪</span>
                  <span class="tl-name">간식</span>
                  <span class="tl-time">그 외 시간</span>
                </li>
              </ul>
            </div>
          </Transition>
        </div>
        <div class="meal-type-tabs">
          <button
            v-for="tab in MEAL_TABS"
            :key="tab.key"
            class="meal-tab"
            :class="{ active: selectedMeal === tab.key }"
            :style="selectedMeal === tab.key
              ? { '--meal-color': tab.color, '--meal-bg': tab.bg, borderColor: tab.color }
              : {}"
            type="button"
            @click="selectedMeal = tab.key"
          >
            <span class="meal-tab-emoji">{{ tab.emoji }}</span>
            <span class="meal-tab-label">{{ tab.label }}</span>
            <span v-if="selectedMeal === tab.key" class="meal-tab-check">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>
        </div>
      </div>

      <!-- 식사 시간 -->
      <div class="diet-section">
        <div class="diet-section-label">
          <span class="diet-section-dot"></span>
          식사 시간
        </div>
        <div class="time-input-wrapper">
          <input type="time" class="time-input" v-model="selectedTime" />
        </div>
      </div>

      <!-- ── 식품 검색 ── -->
      <div class="diet-section">
        <div class="diet-section-label">
          <span class="diet-section-dot"></span>
          식품 검색
        </div>

        <div class="fsb-wrap">
          <!-- 검색 입력 -->
          <div class="fsb-input-row">
            <input
              v-model="searchQuery"
              class="fsb-input"
              type="text"
              placeholder="음식 이름을 검색하세요 (예: 김치찌개)"
              autocomplete="off"
              @keydown.enter.prevent="doSearch"
            />
            <button
              class="fsb-btn"
              type="button"
              :disabled="searchLoading || searchQuery.trim().length < 1"
              @click="doSearch"
            >
              <span v-if="searchLoading" class="fsb-spin" aria-hidden="true"></span>
              <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.8"/>
                <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- 검색 결과 패널 -->
          <Transition name="fsb-panel">
            <div v-if="searchResults.length > 0" class="fsb-results">
              <div class="fsb-results-header">
                <span class="fsb-results-label">검색 결과</span>
                <span class="fsb-results-count">{{ searchResults.length }}건</span>
                <button class="fsb-results-close" type="button" aria-label="닫기" @click="clearSearch">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>

              <div class="fsb-result-list">
                <div
                  v-for="result in searchResults"
                  :key="result.food_code || result.food_name"
                  class="fsb-result-item"
                >
                  <!-- 상품 이미지 썸네일 -->
                  <div class="fsb-ri-thumb" aria-hidden="true">
                    <span class="fsb-ri-thumb-fallback">🍽️</span>
                    <img
                      v-if="result.img_url"
                      :src="result.img_url.replace('http://', 'https://')"
                      :alt="result.food_name"
                      class="fsb-ri-img"
                      loading="lazy"
                      @error="(e) => ((e.target as HTMLImageElement).style.opacity = '0')"
                    />
                  </div>

                  <!-- 텍스트 정보 -->
                  <div class="fsb-ri-body">
                    <span class="fsb-ri-name">{{ result.food_name }}</span>
                    <span class="fsb-ri-meta">
                      <span v-if="result.maker" class="fsb-ri-brand">{{ result.maker }}</span>
                      <span v-if="result.maker && result.category" class="fsb-ri-dot">·</span>
                      <span v-if="result.category">{{ result.category }}</span>
                    </span>
                    <div class="fsb-ri-tags">
                      <template v-if="result.allergens.length > 0">
                        <span class="fsb-ri-allergy-warn">⚠</span>
                        <span
                          v-for="a in result.allergens"
                          :key="a"
                          class="fsb-ri-allergy-chip"
                        >{{ allergenLabel(a) }}</span>
                      </template>
                      <span v-else class="fsb-ri-no-allergy">✓ 알레르기 없음</span>
                    </div>
                  </div>

                  <!-- 추가 버튼 -->
                  <button
                    class="fsb-ri-add-btn"
                    type="button"
                    @click="addFoodFromResult(result)"
                  >
                    <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                      <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    추가
                  </button>
                </div>
              </div>
            </div>
          </Transition>

          <!-- 에러 / 결과 없음 메시지 -->
          <Transition name="fsb-panel">
            <div v-if="searchError" class="fsb-error">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
                <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              {{ searchError }}
            </div>
          </Transition>
        </div>
      </div>

      <!-- ── 음식 목록 ── -->
      <div class="diet-section">
        <div class="diet-section-label">
          <span class="diet-section-dot"></span>
          음식 목록
          <span class="diet-section-count">{{ foodItems.filter(f => f.name.trim()).length }}가지</span>
        </div>

        <div class="diet-food-card">
          <!-- 빈 상태 -->
          <div v-if="foodItems.length === 0" class="food-empty-state">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="13" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.35"/>
              <path d="M14 9v6M14 17.5v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.45"/>
            </svg>
            <p class="food-empty-text">위에서 식품을 검색하여 추가하거나<br>직접 입력 버튼을 눌러주세요</p>
          </div>

          <!-- 추가된 음식 목록 -->
          <div v-else class="food-list">
            <TransitionGroup name="food-item">
              <div v-for="(item, idx) in foodItems" :key="item.id" class="food-item-row">
                <span class="food-item-idx">{{ idx + 1 }}</span>

                <div class="food-item-body">
                  <div class="food-item-name-row">
                    <!-- 검색으로 추가: 이름은 텍스트 표시 -->
                    <span v-if="item.food_code" class="food-item-name-text">{{ item.name }}</span>
                    <!-- 직접 입력: 이름은 input -->
                    <input
                      v-else
                      v-model="item.name"
                      class="food-input food-name-only"
                      type="text"
                      placeholder="음식 이름"
                      maxlength="50"
                      autocomplete="off"
                    />
                    <!-- 양 스테퍼 -->
                    <div class="food-amount-stepper">
                      <button
                        type="button"
                        class="fas-btn fas-minus"
                        :disabled="item.amount <= 1"
                        aria-label="1 감소"
                        @click="changeAmount(item, -1)"
                      >
                        <svg width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
                          <path d="M1 1h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                      </button>
                      <input
                        v-model.number="item.amount"
                        class="fas-input"
                        type="number"
                        min="1"
                        max="9999"
                        inputmode="numeric"
                        aria-label="양"
                        @change="clampAmount(item)"
                        @blur="clampAmount(item)"
                      />
                      <button
                        type="button"
                        class="fas-btn fas-plus"
                        aria-label="1 증가"
                        @click="changeAmount(item, 1)"
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <!-- 알레르기 / 칼로리 정보 -->
                  <div v-if="item.allergens !== undefined" class="food-allergen-row">
                    <template v-if="item.allergens.length === 0">
                      <span class="fa-ok">✓ 주요 알레르기 없음</span>
                    </template>
                    <template v-else>
                      <span class="fa-warn">⚠</span>
                      <span v-for="a in item.allergens" :key="a" class="fa-chip">{{ allergenLabel(a) }}</span>
                    </template>
                    <span v-if="item.calories != null" class="fa-kcal">{{ item.calories }}kcal</span>
                  </div>
                </div>

                <button
                  class="btn-remove-food"
                  type="button"
                  aria-label="항목 삭제"
                  @click="removeFood(item.id)"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </TransitionGroup>
          </div>

          <!-- 직접 입력 버튼 -->
          <button class="btn-add-food" type="button" @click="addFoodManual">
            <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
            직접 입력
          </button>
        </div>
      </div>

      <!-- 메모 -->
      <div class="diet-section">
        <div class="diet-section-label">
          <span class="diet-section-dot"></span>
          메모
          <span class="diet-section-optional">선택</span>
        </div>
        <div class="diet-memo-wrap">
          <textarea
            v-model="memo"
            class="diet-memo"
            placeholder="특이사항이나 느낀 점을 자유롭게 적어보세요…"
            :maxlength="MEMO_MAX"
            rows="3"
          ></textarea>
          <span class="diet-memo-count">{{ memo.length }}<span class="diet-memo-max"> / {{ MEMO_MAX }}</span></span>
        </div>
      </div>

      <!-- 에러 -->
      <Transition name="su-error-slide">
        <div v-if="errorMsg" class="su-error">
          <span class="su-error-icon">⚠️</span>
          {{ errorMsg }}
        </div>
      </Transition>

      <!-- 제출 -->
      <div class="diet-submit-wrap">
        <button class="diet-submit-btn" type="submit" :disabled="isSubmitting">
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
</template>

<style scoped>
.time-input-wrapper {
  position: relative;
}

.time-input {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #EAECEE;
  border-radius: 10px;
  background-color: #F9FAFB;
  font-size: 1rem;
  line-height: 1.5;
  font-family: inherit;
  color: #333;
  transition: border-color 0.2s;
}

.time-input:focus {
  outline: none;
  border-color: #B0B0B0;
}
</style>
