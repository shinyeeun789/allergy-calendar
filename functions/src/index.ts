import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'

// ── 초기화 ──────────────────────────────────────────────────
initializeApp()
const db = getFirestore()

// HACCP API 키 (Firebase Secret Manager에서 관리)
// 공공데이터포털 (data.go.kr) → "일반 인증키(Encoding)" 값을 그대로 사용
// 설정: firebase functions:secrets:set FOODSAFETY_API_KEY
const FOODSAFETY_API_KEY = defineSecret('FOODSAFETY_API_KEY')

// ── HACCP 제품이미지 및 포장지표기정보 API 응답 타입 ────────────
// GET https://apis.data.go.kr/B553748/CertImgListServiceV3/getCertImgListServiceV3
// 일부 제품은 nutrient, barcode, seller 태그 자체가 없을 수 있음 → optional
interface HaccpItem {
  rnum:           string | number
  prdlstReportNo: string             // 품목보고번호 (고유 ID)
  productGb:      string             // 제품구분 (식품, 건강기능식품 등)
  prdlstNm:       string             // 제품명
  rawmtrl:        string             // 원재료명
  allergy:        string             // 알레르기 유발물질 ("우유,밀" / "없음" / 미존재)
  nutrient?:      string             // 영양성분 텍스트 (태그 없을 수 있음)
  barcode?:       string             // 바코드 (태그 없을 수 있음)
  prdkind:        string             // 품목유형 (예: 과자류)
  prdkindstate?:  string             // 포장단위 (예: 60g/1개)
  manufacture?:   string             // 제조사
  seller?:        string             // 판매사 (태그 없을 수 있음)
  imgurl1:        string             // 제품 이미지 1
  imgurl2:        string             // 제품 이미지 2
}

// ── Firestore 저장 타입 ───────────────────────────────────────
export interface FoodDocument {
  // 검색
  food_code:        string
  food_name:        string
  food_name_search: string     // 정규화된 이름 (전방 일치 검색용)
  search_keywords:  string[]   // n-gram 키워드 배열 (array-contains 검색용)

  // 항상 저장 (API 필드 직매핑)
  product_gb:       string     // productGb: 제품구분 (식품/건강기능식품 등)
  category:         string     // prdkind: 품목유형
  allergy_raw:      string     // allergy 원문
  allergens:        string[]   // allergy 파싱 결과
  barcode:          string     // barcode (알수없음 포함)
  img_url:          string     // imgurl1
  img_url2:         string     // imgurl2

  // 존재하는 경우에만 유효값 저장
  seller_name:      string | null   // seller에서 회사명만 추출 (알수없음이면 null)

  // 영양
  nutrition: {
    calories_kcal:  number | null   // 유효값이면 저장, 없으면 null
    carbs_g:        number | null
    protein_g:      number | null
    fat_g:          number | null
    sodium_mg:      number | null
    sugar_g:        number | null
    fiber_g:        number | null
    cholesterol_mg: number | null
    sat_fat_g:      number | null
  }
  cached_at: FieldValue
}

// ── 유틸 함수 ────────────────────────────────────────────────

/** 검색어 정규화 */
function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 제품명 → 검색 키워드 배열 (슬라이딩 윈도우 n-gram)
 *
 * "핵불닭볶음면" → ["핵불", "핵불닭", ..., "불닭볶음면", ..., "핵불닭볶음면"]
 * 공백으로 분리된 각 단어에 대해 길이 2 이상의 모든 부분 문자열을 생성한다.
 * 이를 통해 "불닭볶음면" 검색 시 "핵불닭볶음면"도 캐시에서 히트된다.
 */
function buildSearchKeywords(name: string): string[] {
  const normalized = normalizeQuery(name)
  const keywords   = new Set<string>([normalized])

  // 공백 기준으로 단어 분리
  const words = normalized.split(' ').filter(w => w.length >= 2)

  for (const word of words) {
    keywords.add(word)
    const len = word.length
    for (let start = 0; start < len; start++) {
      for (let end = start + 2; end <= len; end++) {
        keywords.add(word.slice(start, end))
      }
    }
  }

  // Firestore 문서 크기 1MB 이내, 인덱스 엔트리 20,000개 이내
  // 길이 20자 단어 기준 최대 190개, 실제 식품명 기준 충분한 여유
  return [...keywords]
}


/**
 * HACCP API allergy 필드 파싱
 * "밀,대두,조개류(굴,전복,홍합포함) 함유" → ["밀", "대두", "조개류(굴,전복,홍합 포함)"]
 *
 * - 괄호(()) 안의 콤마는 분리하지 않아 "조개류(굴,전복,홍합포함)"를 하나로 처리
 * - 각 항목 끝의 "함유" 제거
 * - "포함)" → " 포함)" 공백 정규화
 * - 비어 있거나 "-", "없음", "해당없음", "알수없음" → []
 */
function parseAllergyField(allergyStr: string): string[] {
  // ① ※ 이후 원산지·성분 주석 제거
  // 예) "조개류(홍합)함유 ※특정성분함량및원산지:닭고기0.62%(국내산)" → "조개류(홍합)함유"
  const s = (allergyStr ?? '').replace(/\s*※.*$/s, '').trim()
  if (!s || s === '-' || s === '해당없음' || s === '없음' || s === '알수없음') {
    return []
  }
  // 괄호 깊이를 추적하여 괄호 밖의 구분자(,·)로만 분리
  const items: string[] = []
  let current = ''
  let depth   = 0

  for (const ch of s) {
    if (ch === '(' || ch === '（') {
      depth++
      current += ch
    } else if (ch === ')' || ch === '）') {
      depth--
      current += ch
    } else if (depth === 0 && /[,，、·]/.test(ch)) {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) items.push(current)

  return items
    .map(s => s
      .trim()
      .replace(/\s*함유\s*$/, '')     // 끝에 붙은 "함유" 제거 (예: "조개류(...) 함유")
      .replace(/([^ ])포함\)/, '$1 포함)')  // "홍합포함)" → "홍합 포함)"
      .trim()
    )
    .filter(s => s.length > 0)
}

/**
 * allergies 컬렉션 코드값 기준 알레르기 매핑 테이블
 * - 긴 키워드 / 특수 케이스 우선 정렬 (짧은 키워드의 오매칭 방지)
 * - 매칭 시 괄호 안 내용은 제거하고 주요 알레르기명만 비교
 */
const ALLERGEN_KEYWORD_MAP: Array<{ keyword: string; code: string }> = [
  { keyword: '아황산류',  code: 'SULFITE'   },
  { keyword: '조개류',    code: 'SHELLFISH'  },
  { keyword: '돼지고기',  code: 'PORK'      },
  { keyword: '닭고기',    code: 'CHICKEN'   },
  { keyword: '소고기',    code: 'BEEF'      },
  { keyword: '쇠고기',    code: 'BEEF'      },
  { keyword: '고등어',    code: 'MACKEREL'  },
  { keyword: '오징어',    code: 'SQUID'     },
  { keyword: '복숭아',    code: 'PEACH'     },
  { keyword: '토마토',    code: 'TOMATO'    },
  { keyword: '전복',      code: 'ABALONE'   },
  { keyword: '홍합',      code: 'MUSSEL'    },
  { keyword: '메밀',      code: 'BUCKWHEAT' },
  { keyword: '땅콩',      code: 'PEANUT'    },
  { keyword: '호두',      code: 'WALNUT'    },
  { keyword: '대두',      code: 'SOY'       },
  { keyword: '난류',      code: 'EGG'       },
  { keyword: '달걀',      code: 'EGG'       },
  { keyword: '계란',      code: 'EGG'       },
  { keyword: '우유',      code: 'MILK'      },
  { keyword: '잣',        code: 'PINE_NUT'  },
  { keyword: '새우',      code: 'SHRIMP'    },
  { keyword: '홍합',      code: 'MUSSEL'    },
  { keyword: '밀',        code: 'WHEAT'     },
  { keyword: '콩',        code: 'SOY'       },
  { keyword: '굴',        code: 'OYSTER'    },
  { keyword: '게',        code: 'CRAB'      },
]

/**
 * 파싱된 알레르기 문자열 배열 → 코드값 배열로 변환
 *
 * - 매칭 성공: allergies 컬렉션 코드 (예: 'MILK', 'WHEAT')
 * - 매칭 실패: 원문 그대로 포함 + unmatched 배열에도 추가
 *
 * 매칭 방식:
 *   "조개류(굴,전복,홍합 포함)" → 괄호 제거 → "조개류" → 'SHELLFISH'
 *   "새우"                      → "새우"     → 'SHRIMP'
 *   "미역추출물"                → 미매칭     → 원문 그대로 저장
 */
function resolveAllergenCodes(rawAllergens: string[]): {
  allergens:  string[]   // 코드 + 미매칭 원문 혼합 배열 (foods.allergens에 저장)
  unmatched:  string[]   // 미매칭 원문만 (allergen_candidates 저장용)
} {
  const allergens: string[]  = []
  const unmatched: string[]  = []
  const seenCodes             = new Set<string>()

  for (const raw of rawAllergens) {
    // 괄호 내용 제거하여 주요 알레르기명만 추출
    // "조개류(굴,전복,홍합 포함)" → "조개류"
    const primary = raw
      .replace(/（[^）]*）|\([^)]*\)/g, '')  // 전각·반각 괄호 모두 제거
      .trim()

    let matchedCode: string | null = null
    for (const { keyword, code } of ALLERGEN_KEYWORD_MAP) {
      if (primary.includes(keyword)) {
        matchedCode = code
        break
      }
    }

    if (matchedCode) {
      // 동일 코드 중복 방지 (예: "난류"·"달걀" 둘 다 있을 때 EGG 1번만)
      if (!seenCodes.has(matchedCode)) {
        seenCodes.add(matchedCode)
        allergens.push(matchedCode)
      }
    } else {
      // 매칭 실패 → 원문 그대로 저장 (음식 데이터에도 포함)
      allergens.push(raw)
      unmatched.push(raw)
    }
  }

  return { allergens, unmatched }
}

/**
 * seller 필드에서 회사명만 추출
 *
 * 구분자 패턴: "_", "/", ":", " 본사", "본사"
 * 예) "삼양식품㈜ 본사:서울특별시..."  → "삼양식품㈜"
 *     "삼양식품㈜_서울특별시..."       → "삼양식품㈜"
 *     "삼양식품㈜/서울특별시..."       → "삼양식품㈜"
 *     "삼양식품㈜:서울특별시..."       → "삼양식품㈜"
 *     "알수없음"                       → null
 */
function parseSellerName(seller: string): string | null {
  const s = (seller ?? '').trim()
  if (!s || s.includes('알수없음')) return null

  // 회사명 끝 지점: 구분자(_/:) 또는 "본사"/"공장" 키워드 직전
  const match = s.match(/^([^_/:]+?)(?:\s*(?:본사|공장)|[_/:]|$)/)
  const name   = match ? match[1].trim() : s
  return name || null
}

/**
 * HACCP API nutrient 텍스트 파싱
 * 예: "열량 270.22 kcal, 나트륨 115.5mg(6%),탄수화물44.3g(14%), ..."
 */
function parseNutrientStr(nutrientStr: string): FoodDocument['nutrition'] {
  if (!nutrientStr) {
    return {
      calories_kcal: null, carbs_g: null, protein_g: null,
      fat_g: null, sodium_mg: null, sugar_g: null,
      fiber_g: null, cholesterol_mg: null, sat_fat_g: null,
    }
  }

  // "포화지방", "트랜스지방" 을 먼저 치환해서 "지방" 단독 추출 방해를 방지
  const safe = nutrientStr
    .replace(/포화지방/g, '__SAT_FAT__')
    .replace(/트랜스지방/g, '__TRANS_FAT__')

  const num = (str: string, pattern: RegExp): number | null => {
    const m = str.match(pattern)
    return m ? parseFloat(m[1]) : null
  }

  return {
    calories_kcal:  num(nutrientStr, /열량\s*([\d.]+)\s*kcal/i),
    sodium_mg:      num(nutrientStr, /나트륨\s*([\d.]+)\s*mg/i),
    carbs_g:        num(nutrientStr, /탄수화물\s*([\d.]+)\s*g/i),
    sugar_g:        num(nutrientStr, /당류\s*([\d.]+)\s*g/i),
    fat_g:          num(safe,        /지방\s*([\d.]+)\s*g/i),   // 포화/트랜스 제외
    sat_fat_g:      num(nutrientStr, /포화지방\s*([\d.]+)\s*g/i),
    cholesterol_mg: num(nutrientStr, /콜레스테롤\s*([\d.]+)\s*mg/i),
    protein_g:      num(nutrientStr, /단백질\s*([\d.]+)\s*g/i),
    fiber_g:        num(nutrientStr, /식이섬유\s*([\d.]+)\s*g/i),
  }
}

/**
 * HACCP API 아이템 1개 → FoodDocument 변환
 *
 * allergens 필드:
 *   - allergies 컬렉션 코드값으로 매핑된 항목 (예: 'MILK', 'WHEAT')
 *   - 매핑 실패 항목은 원문 그대로 포함
 *   - unmatchedAllergens: 매핑 실패 원문 목록 (allergen_candidates 저장용)
 */
function itemToDocument(item: HaccpItem): {
  doc:                Omit<FoodDocument, 'cached_at'>
  unmatchedAllergens: string[]
} {
  const foodName   = item.prdlstNm ?? ''
  const allergyRaw = item.allergy  ?? ''

  const rawAllergens              = parseAllergyField(allergyRaw)
  const { allergens, unmatched }  = resolveAllergenCodes(rawAllergens)

  return {
    doc: {
      // 검색
      food_code:        String(item.prdlstReportNo ?? ''),
      food_name:        foodName,
      food_name_search: normalizeQuery(foodName),
      search_keywords:  buildSearchKeywords(foodName),

      // 항상 저장
      product_gb:       item.productGb ?? '',
      category:         item.prdkind   ?? '',
      allergy_raw:      allergyRaw,
      allergens,                          // 코드값 + 미매칭 원문 혼합
      barcode:          item.barcode   ?? '',
      img_url:          item.imgurl1   ?? '',
      img_url2:         item.imgurl2   ?? '',

      // 유효값이 있는 경우에만 저장
      seller_name:      parseSellerName(item.seller ?? ''),

      // 영양
      nutrition:        parseNutrientStr(item.nutrient ?? ''),
    },
    unmatchedAllergens: unmatched,
  }
}

// ── 검색 결과 반환 타입 ──────────────────────────────────────
function docToResult(d: FirebaseFirestore.DocumentData) {
  return {
    food_code:  d.food_code  as string,
    food_name:  d.food_name  as string,
    category:   d.category   as string,
    maker:      (d.seller_name as string | null) ?? '',
    allergens:  d.allergens  as string[],
    img_url:    (d.img_url   as string) ?? '',
    img_url2:   (d.img_url2  as string) ?? '',
    nutrition:  d.nutrition,
    barcode:    (d.barcode   as string) ?? '',
  }
}

/**
 * 검색어-제품명 유사도 점수 (0 ~ 1+)
 *
 * 기준:
 *   - query.length / name.length : 비율이 높을수록 (이름이 짧을수록) 유사
 *   - 제품명이 검색어로 시작하면 +0.2 보너스
 *   - 완전 일치 → 1.2 (최고)
 *
 * 예) query="불닭"
 *   "불닭"               → 2/2 + 0.2 = 1.2  (완전일치)
 *   "불닭발"             → 2/3 + 0.2 ≈ 0.87
 *   "불닭볶음면"         → 2/5 + 0.2 = 0.60
 *   "까르보불닭볶음면"   → 2/8       = 0.25
 *   "뼈없는…불닭발"      → 2/15      ≈ 0.13
 */
function similarityScore(query: string, foodName: string): number {
  const q = normalizeQuery(query)
  const n = normalizeQuery(foodName)
  if (!n) return 0
  const ratio       = q.length / n.length
  const startsBonus = n.startsWith(q) ? 0.2 : 0
  return ratio + startsBonus
}

/** DB에서 검색 후 유사도 내림차순 정렬하여 반환 */
async function queryFoodsFromDb(
  foodsRef: FirebaseFirestore.CollectionReference,
  normalizedQ: string,
): Promise<ReturnType<typeof docToResult>[]> {
  const snap = await foodsRef
    .where('search_keywords', 'array-contains', normalizedQ)
    .limit(500)
    .get()

  return snap.docs
    .map(doc => docToResult(doc.data()))
    .sort((a, b) => similarityScore(normalizedQ, b.food_name) - similarityScore(normalizedQ, a.food_name))
}

// ── Cloud Function: searchFood ────────────────────────────────
/**
 * HACCP 제품 검색 함수
 *
 * 캐싱 전략:
 *   - 이전에 검색한 적 있는 검색어(search_queries 문서 존재) → foods DB만 조회
 *   - 처음 검색하는 검색어 → HACCP API 호출 → foods 저장 → search_queries 저장 → 반환
 */
export const searchFood = onCall(
  {
    secrets:        [FOODSAFETY_API_KEY],
    region:         'asia-northeast3',
    timeoutSeconds: 30,
    memory:         '256MiB',
  },
  async (request) => {
    // ── 인증 확인 ──
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.')
    }

    const rawQuery: string = (request.data?.query ?? '').trim()
    if (!rawQuery) {
      throw new HttpsError('invalid-argument', '검색어를 입력해주세요.')
    }
    if (rawQuery.length > 50) {
      throw new HttpsError('invalid-argument', '검색어는 50자 이하로 입력해주세요.')
    }

    const normalizedQ      = normalizeQuery(rawQuery)
    const foodsRef         = db.collection('foods')
    const searchQueriesRef = db.collection('search_queries')

    // ── 1. 검색 이력 확인 (6개월 만료 체크) ──
    const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000   // ≈ 180일

    let queryDoc: FirebaseFirestore.DocumentSnapshot
    try {
      queryDoc = await searchQueriesRef.doc(normalizedQ).get()
    } catch (err) {
      console.error('[searchFood] search_queries 조회 실패:', err)
      throw new HttpsError('internal', '검색 이력을 확인하지 못했습니다.')
    }

    const searchedAt   = (queryDoc.data()?.searched_at as FirebaseFirestore.Timestamp | undefined)?.toDate()
    const isStale      = !searchedAt || (Date.now() - searchedAt.getTime() > SIX_MONTHS_MS)

    if (queryDoc.exists && !isStale) {
      // ── 기존 검색어 (6개월 이내) → DB만 조회 (유사도 정렬) ──
      console.info(`[searchFood] 기존 검색어: "${normalizedQ}" → DB 조회 (최근 검색: ${searchedAt?.toISOString()})`)
      try {
        const results = await queryFoodsFromDb(foodsRef, normalizedQ)
        console.info(`[searchFood] DB 조회 결과: ${results.length}건`)
        return { source: 'cache', results }
      } catch (err) {
        console.error('[searchFood] DB 조회 실패 (캐시 경로):', err)
        throw new HttpsError('internal', '식품 데이터를 조회하지 못했습니다.')
      }
    }

    if (queryDoc.exists && isStale) {
      console.info(`[searchFood] 검색 데이터 만료: "${normalizedQ}" (최근 검색: ${searchedAt?.toISOString()}) → API 재조회`)
    }

    // ── 2. 신규 검색어 또는 6개월 만료 → HACCP API 호출 (페이지네이션) ──
    let apiKey: string
    try {
      apiKey = FOODSAFETY_API_KEY.value()
    } catch (err) {
      console.error('[searchFood] 시크릿 로드 실패:', err)
      throw new HttpsError('internal', 'API 키를 불러오지 못했습니다.')
    }

    const PAGE_SIZE  = 100   // 1회 호출당 가져올 수
    const MAX_ITEMS  = 500   // 저장 상한 (지나치게 광범위한 검색어 대비)

    /** 특정 페이지 XML을 요청하고 파싱 결과를 반환 */
    const parser = new XMLParser({
      ignoreAttributes: true,
      isArray: (name) => name === 'item',
    })

    async function fetchPage(pageNo: number) {
      const url =
        `https://apis.data.go.kr/B553748/CertImgListServiceV3/getCertImgListServiceV3` +
        `?serviceKey=${apiKey}` +
        `&pageNo=${pageNo}` +
        `&numOfRows=${PAGE_SIZE}` +
        `&prdlstNm=${encodeURIComponent(rawQuery)}`

      const res = await axios.get<string>(url, { timeout: 10_000, responseType: 'text' })
      return parser.parse(res.data)
    }

    console.info(`[searchFood] 신규 검색어: "${normalizedQ}" → API 호출 (page 1)`)

    let firstParsed: any
    try {
      firstParsed = await fetchPage(1)
    } catch (err: any) {
      console.error('[searchFood] API 호출 실패:', err?.message ?? err)
      throw new HttpsError('unavailable', '식품 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.')
    }

    // data.go.kr API는 정상 응답과 오류 응답의 XML 루트 구조가 다를 수 있음
    // 정상: <response><header><resultCode>OK</resultCode>...
    // 오류: <OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>...
    const header     = firstParsed?.response?.header ?? firstParsed?.header ?? {}
    const firstBody  = firstParsed?.response?.body   ?? firstParsed?.body   ?? {}
    const resultCode = String(header?.resultCode ?? '')

    if (resultCode !== '00' && resultCode !== 'OK' && resultCode !== '0000') {
      // 오류 원인 파악을 위해 파싱된 응답 루트 키와 앞부분 로그
      const rootKeys = Object.keys(firstParsed ?? {})
      const errDetail =
        firstParsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ??
        firstParsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg ??
        header?.resultMsg ??
        '알 수 없음'
      console.warn('[searchFood] API 비정상 응답 — resultCode:', resultCode, '| 루트 키:', rootKeys, '| 오류:', errDetail)
      return { source: 'api', results: [] }
    }

    const totalCount = parseInt(String(firstBody?.totalCount ?? '0'), 10)
    const items: HaccpItem[] = [...(firstBody?.items?.item ?? [])]

    // 추가 페이지가 있으면 순차 호출
    if (totalCount > PAGE_SIZE) {
      const totalPages = Math.min(
        Math.ceil(totalCount / PAGE_SIZE),
        Math.ceil(MAX_ITEMS  / PAGE_SIZE),
      )
      for (let page = 2; page <= totalPages; page++) {
        console.info(`[searchFood] API 호출 (page ${page}/${totalPages})`)
        try {
          const parsed = await fetchPage(page)
          const body   = parsed?.response?.body ?? parsed?.body ?? {}
          const pageItems: HaccpItem[] = body?.items?.item ?? []
          items.push(...pageItems)
        } catch (err: any) {
          console.warn(`[searchFood] page ${page} 호출 실패 (무시):`, err?.message ?? err)
          break  // 중간 페이지 실패 시 수집된 것만 저장
        }
        if (items.length >= MAX_ITEMS) break
      }
    }

    console.info(`[searchFood] API 결과 ${items.length}건 (총 ${totalCount}건)`)

    // ── 4. Firestore 저장 (foods + search_queries + allergen_candidates) ──
    const batch              = db.batch()
    const candidatesRef      = db.collection('allergen_candidates')
    const seenDocIds         = new Set<string>()   // 중복 ID 감지용
    const seenCandidateIds   = new Set<string>()   // 배치 내 후보 중복 방지용
    let   savedCount         = 0
    let   candidateCount     = 0

    for (const item of items) {
      const { doc, unmatchedAllergens } = itemToDocument(item)

      // food_code가 있으면 사용, 없으면 "이름_rnum" 조합으로 고유성 보장
      const rnum  = String(item.rnum ?? '')
      const docId = doc.food_code ||
        `haccp_${Buffer.from(doc.food_name_search).toString('base64').slice(0, 16)}_${rnum}`

      if (seenDocIds.has(docId)) {
        console.warn(`[searchFood] 중복 docId 감지 (건너뜀): "${docId}" (제품명: ${doc.food_name})`)
        continue
      }
      seenDocIds.add(docId)
      savedCount++

      // foods 저장
      batch.set(
        foodsRef.doc(docId),
        { ...doc, cached_at: FieldValue.serverTimestamp() },
        { merge: true },
      )

      // 매칭 실패 알레르기 → allergen_candidates 저장
      // 관리자가 검토 후 allergies 컬렉션에 새 코드를 추가하거나 기존 코드로 매핑 가능
      for (const raw of unmatchedAllergens) {
        // 괄호 제거 후 정규화하여 문서 ID 생성
        const candidateId = normalizeQuery(
          raw.replace(/（[^）]*）|\([^)]*\)/g, '').trim()
        ).replace(/\//g, '_').slice(0, 200)

        if (!candidateId) continue

        if (!seenCandidateIds.has(candidateId)) {
          seenCandidateIds.add(candidateId)
          candidateCount++
          batch.set(
            candidatesRef.doc(candidateId),
            {
              name_raw:        raw,
              name_normalized: candidateId,
              food_codes:      FieldValue.arrayUnion(docId),
              count:           FieldValue.increment(1),
              first_seen:      FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        } else {
          // 같은 배치 내 이미 등록된 후보 → food_codes만 추가
          batch.set(
            candidatesRef.doc(candidateId),
            { food_codes: FieldValue.arrayUnion(docId) },
            { merge: true },
          )
        }
      }
    }

    console.info(
      `[searchFood] 저장 대상: foods ${savedCount}건` +
      ` (중복 ${items.length - savedCount}건 제외)` +
      ` | allergen_candidates ${candidateCount}건`,
    )

    // 검색 이력 기록 (결과가 0건이어도 기록 → 다음 요청에서 API 재호출 방지)
    batch.set(searchQueriesRef.doc(normalizedQ), {
      query:            normalizedQ,
      api_count:        items.length,      // API 원본 건수
      saved_count:      savedCount,        // 중복 제외 후 실제 저장 건수
      searched_at:      FieldValue.serverTimestamp(),
    })

    try {
      await batch.commit()
      console.info(
        `[searchFood] Firestore 저장 완료: foods ${savedCount}건,` +
        ` allergen_candidates ${candidateCount}건, search_queries 1건`,
      )
    } catch (err) {
      console.error('[searchFood] Firestore 저장 실패:', err)
    }

    // ── 5. 저장 후 DB 재조회 (유사도 정렬) ──
    try {
      const dbResults = await queryFoodsFromDb(foodsRef, normalizedQ)
      console.info(`[searchFood] DB 재조회 결과: ${dbResults.length}건`)
      return { source: 'api', results: dbResults }
    } catch (err) {
      console.error('[searchFood] DB 재조회 실패 (API 경로):', err)
      throw new HttpsError('internal', '식품 데이터를 조회하지 못했습니다.')
    }
  },
)
