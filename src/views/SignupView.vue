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
const nickVerified  = ref(false)
const nickLocked    = ref(false)
const checkingNick  = ref(false)
const nickStatusMsg = ref('')
const nickStatusType = ref<'ok' | 'fail' | ''>('')

const nickBtnText = computed(() => {
  if (checkingNick.value) return '확인 중…'
  if (nickVerified.value) return '확인 완료'
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

  if (!nick) {
    setNickStatus('fail', '닉네임을 입력해주세요.')
    return
  }
  if (nick.length < 2 || nick.length > 12) {
    setNickStatus('fail', '닉네임은 2~12자로 입력해주세요.')
    return
  }
  if (!/^[가-힣a-zA-Z0-9]+$/.test(nick)) {
    setNickStatus('fail', '한글·영문·숫자만 사용할 수 있습니다.')
    return
  }

  checkingNick.value = true
  try {
    const snap = await getDoc(doc(db, 'usernames', nick.toLowerCase()))
    if (snap.exists()) {
      nickVerified.value = false
      setNickStatus('fail', '이미 사용 중인 닉네임입니다.')
    } else {
      nickVerified.value = true
      nickLocked.value   = true
      setNickStatus('ok', '사용 가능한 닉네임입니다. ✓')
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

  if (!nickVerified.value) {
    errorMessage.value = '닉네임 중복 확인을 완료해주세요.'
    return
  }
  if (password.value !== passwordConfirm.value) {
    errorMessage.value = '비밀번호가 일치하지 않습니다.'
    return
  }
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
      uid:         user.uid,
      displayName: nick,
      createdAt:   serverTimestamp()
    })
    await sendEmailVerification(user, {
      url: window.location.origin + '/login'
    })
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

onMounted(() => document.body.classList.add('signup-body'))
onUnmounted(() => document.body.classList.remove('signup-body'))
</script>

<template>
  <div class="split-container">
    <!-- Left: Brand Panel -->
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

    <!-- Right: Form Panel -->
    <div class="signup-form-panel">
      <div class="signup-form-inner">
        <div class="step-badge">
          <div class="step-dot"></div>
          계정 만들기
        </div>
        <div class="form-header">
          <h2>반가워요 👋</h2>
          <p>간단한 정보만 입력하면 바로 시작할 수 있어요.</p>
        </div>

        <button class="btn-google" type="button" @click="handleGoogleSignup">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
          Google로 빠르게 시작하기
        </button>

        <div class="divider"><span>또는 이메일로 가입</span></div>

        <form @submit.prevent="handleSignup" novalidate>
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
                  placeholder="사용할 닉네임"
                  autocomplete="nickname"
                  @input="onNicknameInput"
                >
                <span class="input-status" :class="nickInputClass">{{ nickInputIcon }}</span>
              </div>
              <button
                type="button"
                class="btn-secondary"
                @click="checkNickname"
                :disabled="checkingNick || nickVerified"
              >{{ nickBtnText }}</button>
            </div>
            <div v-if="nickStatusMsg" class="nick-status" :class="nickStatusType">
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
            <label for="password">비밀번호</label>
            <div class="input-wrap">
              <input
                type="password"
                id="password"
                v-model="password"
                placeholder="8자 이상·영문·숫자·특수문자"
                autocomplete="new-password"
              >
              <span class="input-status" :class="pwStatusClass">{{ pwStatusIcon }}</span>
            </div>
            <div v-if="strengthInfo" class="pw-strength visible">
              <div class="strength-track">
                <div
                  class="strength-fill"
                  :style="{ width: strengthInfo.width, background: strengthInfo.color }"
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

          <div v-if="errorMessage" class="error-text">{{ errorMessage }}</div>

          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? '처리 중…' : '회원가입 완료' }}
          </button>
        </form>

        <p class="privacy-note">
          가입하면 에이체크의 <a href="#">이용약관</a> 및
          <a href="#">개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
        </p>

        <div class="action-links">
          이미 계정이 있으신가요?
          <RouterLink to="/login">로그인하기</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nick-status {
  font-size: 12px;
  font-weight: 600;
  margin-top: 6px;
  padding-left: 2px;
}
.nick-status.ok   { color: #3db37a; }
.nick-status.fail { color: #e53e3e; }
</style>
