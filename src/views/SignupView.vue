<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/firebase'

const router = useRouter()

// ── 폼 필드 ──
const nickname        = ref('')
const email           = ref('')
const password        = ref('')
const passwordConfirm = ref('')
const errorMessage    = ref('')
const submitting      = ref(false)

// ── 닉네임 중복 확인 ──
const nickVerified   = ref(false)
const nickLocked     = ref(false)
const checkingNick   = ref(false)
const nickStatusMsg  = ref('')
const nickStatusType = ref<'ok' | 'fail' | ''>('')

const nickBtnText = computed(() => {
  if (checkingNick.value) return '확인 중…'
  if (nickVerified.value) return '✓ 완료'
  return '중복 확인'
})

function onNicknameInput() {
  nickVerified.value   = false
  nickLocked.value     = false
  nickStatusMsg.value  = ''
  nickStatusType.value = ''
}

async function checkNickname() {
  const nick = nickname.value.trim()
  nickStatusMsg.value  = ''
  nickStatusType.value = ''

  if (!nick) { setNickStatus('fail', '닉네임을 입력해주세요.'); return }
  if (nick.length < 2 || nick.length > 12) { setNickStatus('fail', '닉네임은 2~12자로 입력해주세요.'); return }
  if (!/^[가-힣a-zA-Z0-9]+$/.test(nick)) { setNickStatus('fail', '한글·영문·숫자만 사용할 수 있습니다.'); return }

  checkingNick.value = true
  try {
    const snap = await getDoc(doc(db, 'usernames', nick.toLowerCase()))
    if (snap.exists()) {
      nickVerified.value = false
      setNickStatus('fail', '이미 사용 중인 닉네임입니다.')
    } else {
      nickVerified.value = true
      nickLocked.value   = true
      setNickStatus('ok', '사용 가능한 닉네임입니다.')
    }
  } catch {
    setNickStatus('fail', '확인 중 오류가 발생했습니다. 다시 시도해주세요.')
  } finally {
    checkingNick.value = false
  }
}

function setNickStatus(type: 'ok' | 'fail', msg: string) {
  nickStatusType.value = type
  nickStatusMsg.value  = msg
}

// ── 비밀번호 강도 ──
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}$/

const strengthLevels = [
  { label: '매우 약함', color: '#e53e3e', width: '20%' },
  { label: '약함',     color: '#f6893d', width: '40%' },
  { label: '보통',     color: '#f0c030', width: '60%' },
  { label: '강함',     color: '#3db37a', width: '80%' },
  { label: '매우 강함', color: '#2a9e65', width: '100%' },
]

function calcStrength(pw: string): number {
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[!@#$%^&*()_+\-=[\]{}|;',.<>?/`~":\\]/.test(pw)) score++
  return Math.min(score, 4)
}

const strengthIndex = computed(() => {
  if (!password.value) return -1
  return calcStrength(password.value)
})

const strengthInfo = computed(() => {
  if (!password.value) return null
  return strengthLevels[calcStrength(password.value)]
})

const pwStatusIcon = computed(() => {
  if (!password.value) return ''
  return passwordRegex.test(password.value) ? '✓' : '✕'
})
const pwStatusClass = computed(() => {
  if (!password.value) return ''
  return passwordRegex.test(password.value) ? 'visible ok' : 'visible fail'
})

// ── 비밀번호 확인 ──
const confirmStatusIcon = computed(() => {
  if (!passwordConfirm.value) return ''
  return password.value === passwordConfirm.value ? '✓' : '✕'
})
const confirmStatusClass = computed(() => {
  if (!passwordConfirm.value) return ''
  return password.value === passwordConfirm.value ? 'visible ok' : 'visible fail'
})
const matchHint = computed(() => {
  if (!passwordConfirm.value) return { text: '', cls: 'match-hint' }
  return password.value === passwordConfirm.value
    ? { text: '비밀번호가 일치합니다', cls: 'match-hint ok' }
    : { text: '비밀번호가 일치하지 않습니다', cls: 'match-hint fail' }
})

// ── 이메일 실시간 검증 ──
const emailStatusIcon = computed(() => {
  if (!email.value) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) ? '✓' : '✕'
})
const emailStatusClass = computed(() => {
  if (!email.value) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) ? 'visible ok' : 'visible fail'
})

// ── 닉네임 실시간 검증 아이콘 ──
const nickInputIcon = computed(() => {
  const v = nickname.value.trim()
  if (!v || nickVerified.value) return ''
  return v.length >= 2 ? '✓' : '✕'
})
const nickInputClass = computed(() => {
  const v = nickname.value.trim()
  if (!v || nickVerified.value) return ''
  return v.length >= 2 ? 'visible ok' : 'visible fail'
})

// ── 회원가입 제출 ──
async function handleSignup() {
  errorMessage.value = ''

  if (!nickVerified.value) { errorMessage.value = '닉네임 중복 확인을 완료해주세요.'; return }
  if (password.value !== passwordConfirm.value) { errorMessage.value = '비밀번호가 일치하지 않습니다.'; return }
  if (!passwordRegex.test(password.value)) {
    errorMessage.value = '비밀번호는 8자 이상이며, 영문자·숫자·특수문자를 포함해야 합니다.'
    return
  }

  submitting.value = true
  const nick = nickname.value.trim()

  try {
    const result = await createUserWithEmailAndPassword(auth, email.value, password.value)
    const user = result.user
    await updateProfile(user, { displayName: nick })
    await setDoc(doc(db, 'usernames', nick.toLowerCase()), {
      uid: user.uid, displayName: nick, createdAt: serverTimestamp()
    })
    await sendEmailVerification(user, { url: window.location.origin + '/login' })
    sessionStorage.setItem('pendingEmail', email.value)
    router.push('/verify-email')
  } catch (err: any) {
    if (err.code === 'auth/email-already-in-use') {
      errorMessage.value = '이미 사용 중인 이메일입니다.'
    } else if (err.code === 'auth/weak-password') {
      errorMessage.value = '비밀번호는 6자 이상이어야 합니다.'
    } else {
      errorMessage.value = '회원가입에 실패했습니다. 다시 시도해주세요.'
    }
  } finally {
    submitting.value = false
  }
}

async function handleGoogleSignup() {
  const provider = new GoogleAuthProvider()
  try {
    await signInWithPopup(auth, provider)
    router.push('/')
  } catch {
    errorMessage.value = 'Google 로그인에 실패했습니다.'
  }
}

// ── 준비 중 알럿 ──
const showComingSoon = ref(false)

function openComingSoon()  { showComingSoon.value = true }
function closeComingSoon() { showComingSoon.value = false }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showComingSoon.value) closeComingSoon()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="split-container">

    <!-- ── Left: Brand Panel ── -->
    <div class="brand-panel">
      <div class="brand-logo">A-<span class="accent">Check</span></div>
      <div class="brand-body">
        <div class="brand-badge">Join Us</div>
        <h1 class="brand-headline">
          건강한 습관,<br>
          오늘부터<br>
          <span class="highlight">시작하세요</span>
        </h1>
        <p class="brand-sub">
          무료로 가입하고 나만의 건강 캘린더를<br>
          지금 바로 만들어보세요.
        </p>
        <div class="signup-perks">
          <div class="perk-item">
            <div class="perk-check">✓</div>
            <div class="perk-text">
              <strong>무료로 시작</strong>
              가입 후 모든 기능을 제한 없이 사용
            </div>
          </div>
          <div class="perk-item">
            <div class="perk-check">✓</div>
            <div class="perk-text">
              <strong>데이터 안전 보관</strong>
              Firebase 기반의 안전한 클라우드 저장
            </div>
          </div>
          <div class="perk-item">
            <div class="perk-check">✓</div>
            <div class="perk-text">
              <strong>언제 어디서든</strong>
              모바일·PC 어디서나 기록 조회 가능
            </div>
          </div>
        </div>
      </div>
      <div class="brand-footer">© 2025 A-Check. All rights reserved.</div>
    </div>

    <!-- ── Right: Form Panel ── -->
    <div class="su-panel">
      <div class="su-scroll">
        <div class="su-inner">

          <!-- Header -->
          <div class="su-head">
            <span class="su-tag">✦ 새 계정 만들기</span>
            <h2 class="su-title">반가워요 <span class="su-wave">👋</span></h2>
            <p class="su-sub">간단한 정보만 입력하면 바로 시작할 수 있어요.</p>
          </div>

          <!-- Google -->
          <button class="btn-google" type="button" @click="handleGoogleSignup">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
            Google로 빠르게 시작하기
          </button>

          <div class="divider"><span>또는 이메일로 가입</span></div>

          <!-- Form -->
          <form @submit.prevent="openComingSoon" novalidate>

            <!-- 닉네임 -->
            <div class="input-group">
              <label for="nickname">닉네임</label>
              <div class="input-row">
                <div class="input-wrap" style="flex:1">
                  <input
                    type="text"
                    id="nickname"
                    v-model="nickname"
                    :readonly="nickLocked"
                    placeholder="2~12자, 한글·영문·숫자"
                    autocomplete="nickname"
                    @input="onNicknameInput"
                  >
                  <span class="input-status" :class="nickInputClass">{{ nickInputIcon }}</span>
                </div>
                <button
                  type="button"
                  class="btn-nick-check"
                  :class="{ verified: nickVerified }"
                  @click="checkNickname"
                  :disabled="checkingNick || nickVerified"
                >{{ nickBtnText }}</button>
              </div>
              <div v-if="nickStatusMsg" class="field-hint" :class="nickStatusType">
                {{ nickStatusMsg }}
              </div>
            </div>

            <!-- 이메일 -->
            <div class="input-group">
              <label for="email">이메일 주소</label>
              <div class="input-wrap">
                <input
                  type="email"
                  id="email"
                  v-model="email"
                  placeholder="email@example.com"
                  autocomplete="email"
                >
                <span class="input-status" :class="emailStatusClass">{{ emailStatusIcon }}</span>
              </div>
            </div>

            <!-- 비밀번호 -->
            <div class="input-group">
              <label for="password">
                비밀번호
                <span class="label-hint">8자 이상 · 영문 · 숫자 · 특수문자</span>
              </label>
              <div class="input-wrap">
                <input
                  type="password"
                  id="password"
                  v-model="password"
                  placeholder="••••••••"
                  autocomplete="new-password"
                >
                <span class="input-status" :class="pwStatusClass">{{ pwStatusIcon }}</span>
              </div>
              <div v-if="strengthInfo" class="strength-bar-wrap">
                <div class="strength-segs">
                  <div
                    v-for="i in 5"
                    :key="i"
                    class="strength-seg"
                    :style="{ background: strengthIndex >= i - 1 ? strengthInfo.color : '#e8e8e8' }"
                  ></div>
                </div>
                <span class="strength-label" :style="{ color: strengthInfo.color }">
                  {{ strengthInfo.label }}
                </span>
              </div>
            </div>

            <!-- 비밀번호 확인 -->
            <div class="input-group">
              <label for="password-confirm">비밀번호 확인</label>
              <div class="input-wrap">
                <input
                  type="password"
                  id="password-confirm"
                  v-model="passwordConfirm"
                  placeholder="비밀번호를 한 번 더 입력"
                  autocomplete="new-password"
                >
                <span class="input-status" :class="confirmStatusClass">{{ confirmStatusIcon }}</span>
              </div>
              <div :class="matchHint.cls">{{ matchHint.text }}</div>
            </div>

            <!-- 에러 -->
            <div v-if="errorMessage" class="su-error">
              <span class="su-error-icon">!</span>
              {{ errorMessage }}
            </div>

            <!-- 제출 -->
            <button type="submit" class="su-submit" :disabled="submitting">
              <span>{{ submitting ? '처리 중…' : '회원가입 완료' }}</span>
              <span v-if="!submitting" class="su-arrow">→</span>
            </button>

          </form>

          <!-- 하단 -->
          <p class="privacy-note">
            가입하면 에이체크의 <a href="#">이용약관</a> 및
            <a href="#">개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
          </p>

          <div class="su-login-row">
            이미 계정이 있으신가요?
            <RouterLink to="/login">로그인하기</RouterLink>
          </div>

        </div>
      </div>
    </div>

  </div>

  <!-- ── 준비 중 알럿 ── -->
  <Teleport to="body">
    <Transition name="cs-modal">
      <div
        v-if="showComingSoon"
        class="cs-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="서비스 준비 중"
        @click.self="closeComingSoon"
      >
        <div class="cs-card">
          <!-- 아이콘 -->
          <div class="cs-icon-wrap">
            <span class="cs-icon">🛠️</span>
          </div>

          <!-- 배지 -->
          <span class="cs-badge">✦ 서비스 준비 중</span>

          <!-- 타이틀 -->
          <h3 class="cs-title">곧 만나요!</h3>

          <!-- 설명 -->
          <p class="cs-desc">
            회원가입 기능을 열심히 준비하고 있어요.<br>
            더 좋은 서비스로 찾아올게요 🩷
          </p>

          <!-- 확인 버튼 -->
          <button class="cs-btn" type="button" @click="closeComingSoon">
            알겠어요!
          </button>

          <!-- 닫기 (우상단) -->
          <button class="cs-close" type="button" aria-label="닫기" @click="closeComingSoon">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Right Panel ── */
.su-panel {
  flex: 1;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.su-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 40px;
  min-height: 100%;
  box-sizing: border-box;
}

.su-inner {
  width: 100%;
  max-width: 400px;
}

/* ── Header ── */
.su-head {
  margin-bottom: 28px;
}

.su-tag {
  display: inline-block;
  background: linear-gradient(135deg, #FEF0F4 0%, #fff6f9 100%);
  border: 1px solid rgba(232, 135, 159, 0.28);
  color: #E8879F;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 5px 14px;
  border-radius: 100px;
  margin-bottom: 16px;
}

.su-title {
  font-size: 28px;
  font-weight: 800;
  color: #111;
  margin: 0 0 8px;
  letter-spacing: -0.7px;
  line-height: 1.2;
}

.su-wave {
  display: inline-block;
  font-style: normal;
}

.su-sub {
  font-size: 14px;
  color: #999;
  margin: 0;
  line-height: 1.5;
}

/* ── Label hint ── */
.label-hint {
  font-size: 11px;
  font-weight: 400;
  color: #bbb;
  margin-left: 6px;
}

/* ── Nick check button ── */
.btn-nick-check {
  height: 50px;
  padding: 0 18px;
  background: #111;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, opacity 0.2s, transform 0.15s;
  font-family: 'Noto Sans KR', sans-serif;
  flex-shrink: 0;
}

.btn-nick-check:hover:not(:disabled) {
  background: #333;
}

.btn-nick-check.verified {
  background: #3db37a;
  color: #fff;
}

.btn-nick-check:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Field hint (nick status) ── */
.field-hint {
  font-size: 12px;
  font-weight: 600;
  margin-top: 6px;
  padding-left: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.field-hint.ok   { color: #3db37a; }
.field-hint.fail { color: #e53e3e; }

/* ── Password strength ── */
.strength-bar-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.strength-segs {
  display: flex;
  gap: 4px;
  flex: 1;
}

.strength-seg {
  flex: 1;
  height: 4px;
  border-radius: 4px;
  transition: background 0.3s ease;
}

.strength-label {
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  min-width: 52px;
  text-align: right;
}

/* ── Error box ── */
.su-error {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff5f5;
  border: 1px solid rgba(229, 62, 62, 0.25);
  border-radius: 10px;
  color: #e53e3e;
  font-size: 13px;
  font-weight: 500;
  padding: 11px 14px;
  margin-bottom: 14px;
}

.su-error-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e53e3e;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ── Submit button ── */
.su-submit {
  width: 100%;
  padding: 15px 20px;
  background: linear-gradient(135deg, #E8879F 0%, #D4718C 100%);
  border: none;
  border-radius: 14px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Noto Sans KR', sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: filter 0.2s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 6px 20px rgba(232, 135, 159, 0.38);
  margin-top: 4px;
}

.su-submit:hover:not(:disabled) {
  filter: brightness(1.06);
  box-shadow: 0 8px 24px rgba(232, 135, 159, 0.48);
}

.su-submit:active:not(:disabled) {
  transform: scale(0.98);
}

.su-submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.su-arrow {
  font-size: 17px;
  line-height: 1;
  transition: transform 0.2s;
}

.su-submit:hover:not(:disabled) .su-arrow {
  transform: translateX(3px);
}

/* ── Bottom links ── */
.su-login-row {
  text-align: center;
  font-size: 13.5px;
  color: #999;
  margin-top: 18px;
}

.su-login-row a {
  color: #E8879F;
  text-decoration: none;
  font-weight: 700;
  margin-left: 5px;
  transition: color 0.2s;
}

.su-login-row a:hover {
  color: #D4718C;
  text-decoration: underline;
}

/* ── Responsive ── */
@media (max-width: 900px) {
  .su-panel { width: 100%; }
  .su-scroll { padding: 48px 32px; }
}

@media (max-width: 480px) {
  .su-scroll { padding: 36px 20px; }
  .su-title  { font-size: 24px; }
}


/* ════════════════════════════════
   준비 중 알럿
   ════════════════════════════════ */
.cs-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 10, 0.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.cs-card {
  position: relative;
  width: 100%;
  max-width: 320px;
  background: #fff;
  border-radius: 28px;
  padding: 36px 28px 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
}

/* 아이콘 */
.cs-icon-wrap {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: linear-gradient(135deg, #FEF0F4 0%, #fff5f8 100%);
  border: 1.5px solid rgba(232, 135, 159, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  animation: cs-float 2.8s ease-in-out infinite;
}

.cs-icon {
  font-size: 36px;
  line-height: 1;
  display: block;
  animation: cs-wiggle 2.8s ease-in-out infinite;
}

@keyframes cs-float {
  0%, 100% { transform: translateY(0);    box-shadow: 0 8px 20px rgba(232, 135, 159, 0.18); }
  50%       { transform: translateY(-6px); box-shadow: 0 16px 28px rgba(232, 135, 159, 0.24); }
}

@keyframes cs-wiggle {
  0%, 100% { transform: rotate(0deg); }
  20%       { transform: rotate(-8deg); }
  40%       { transform: rotate(8deg); }
  60%       { transform: rotate(-4deg); }
  80%       { transform: rotate(4deg); }
}

/* 배지 */
.cs-badge {
  display: inline-block;
  background: linear-gradient(135deg, #FEF0F4 0%, #fff5f8 100%);
  border: 1px solid rgba(232, 135, 159, 0.28);
  color: #E8879F;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 4px 13px;
  border-radius: 100px;
  margin-bottom: 14px;
}

/* 타이틀 */
.cs-title {
  font-size: 22px;
  font-weight: 800;
  color: #111;
  margin: 0 0 12px;
  letter-spacing: -0.5px;
}

/* 설명 */
.cs-desc {
  font-size: 14px;
  color: #999;
  line-height: 1.7;
  margin: 0 0 26px;
}

/* 확인 버튼 */
.cs-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #E8879F 0%, #D4718C 100%);
  border: none;
  border-radius: 14px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Noto Sans KR', sans-serif;
  transition: filter 0.2s, transform 0.15s;
  box-shadow: 0 6px 18px rgba(232, 135, 159, 0.36);
}

.cs-btn:hover  { filter: brightness(1.06); }
.cs-btn:active { transform: scale(0.98); transition-duration: 0.08s; }

/* 우상단 닫기 버튼 */
.cs-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: #f5f5f5;
  color: #bbb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.cs-close:hover { background: #ebebeb; color: #555; }

/* 모달 트랜지션 */
.cs-modal-enter-active { transition: opacity 0.22s ease; }
.cs-modal-leave-active { transition: opacity 0.18s ease; }
.cs-modal-enter-from,
.cs-modal-leave-to     { opacity: 0; }

.cs-modal-enter-active .cs-card {
  animation: cs-card-in 0.28s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.cs-modal-leave-active .cs-card {
  animation: cs-card-out 0.18s ease forwards;
}

@keyframes cs-card-in {
  from { transform: scale(0.88) translateY(16px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}
@keyframes cs-card-out {
  from { transform: scale(1)    translateY(0);   opacity: 1; }
  to   { transform: scale(0.92) translateY(8px); opacity: 0; }
}
</style>
