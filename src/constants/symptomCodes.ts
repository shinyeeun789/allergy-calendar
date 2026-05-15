/**
 * 증상 공통코드
 *
 * 1xx — 피부
 * 2xx — 비염/호흡기
 * 3xx — 기타
 */

export const SYMPTOM_CODES = {
  // ── 피부 ──────────────────────────────
  ITCHING:    '100',
  URTICARIA:  '101',
  REDNESS:    '102',
  HEAT:       '103',
  SWELLING:   '104',

  // ── 비염/호흡기 ───────────────────────
  RUNNY_NOSE:  '200',
  SNEEZING:    '201',
  STUFFY_NOSE: '202',
  EYE_ITCHING: '203',
  COUGH:       '204',

  // ── 기타 ──────────────────────────────
  STOMACH_ACHE: '300',
  DIZZINESS:    '301',
} as const

export type SymptomCode = typeof SYMPTOM_CODES[keyof typeof SYMPTOM_CODES]

/** 코드 → 한국어 라벨 (조회/표시용) */
export const SYMPTOM_CODE_LABEL: Record<SymptomCode, string> = {
  '100': '가려움',
  '101': '두드러기',
  '102': '붉어짐',
  '103': '열감',
  '104': '붓기',
  '200': '콧물',
  '201': '재채기',
  '202': '코막힘',
  '203': '눈 가려움',
  '204': '기침',
  '300': '복통',
  '301': '어지러움',
}

/** 피부 증상 코드 집합 (발생 부위 섹션 표시 조건에 사용) */
export const SKIN_SYMPTOM_CODES = new Set<SymptomCode>([
  '100', '101', '102', '103', '104',
])
