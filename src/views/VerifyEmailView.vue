<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { sendEmailVerification, signOut } from 'firebase/auth'
import { auth } from '@/firebase'
import { useAuthStore } from '@/stores/auth'

const router    = useRouter()
const authStore = useAuthStore()

const RESEND_COOLDOWN = 60

const emailDisplay  = ref('')
const pollText      = ref('인증 여부를 확인하고 있습니다…')
const checkLoading  = ref(false)
const resendDisabled = ref(false)
const countdown     = ref(0)
const feedbackMsg   = ref('')
const feedbackType  = ref<'ok' | 'fail' | ''>('')

let pollTimer:      ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  document.body.style.background = '#0f0f0f'

  const user = auth.currentUser
  if (!user) { router.push('/login'); return }

  emailDisplay.value = user.email ?? sessionStorage.getItem('pendingEmail') ?? ''
  startPolling()
})

onUnmounted(() => {
  document.body.style.background = ''
  if (pollTimer)      clearInterval(pollTimer)
  if (countdownTimer) clearInterval(countdownTimer)
})

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(checkVerification, 5000)
}

async function checkVerification() {
  const user = auth.currentUser
  if (!user) return
  try {
    await user.reload()
    const refreshed = auth.currentUser
    if (refreshed?.emailVerified) {
      if (pollTimer) clearInterval(pollTimer)
      // authStore 업데이트
      authStore.user = refreshed
      pollText.value = '인증이 확인됐습니다! 이동합니다…'
      setTimeout(() => router.push('/'), 800)
    }
  } catch (e) {
    console.error(e)
  }
}

async function handleCheckBtn() {
  checkLoading.value = true
  await checkVerification()
  if (!auth.currentUser?.emailVerified) {
    setFeedback('fail', '아직 인증이 완료되지 않았습니다. 메일함을 확인해주세요.')
  }
  checkLoading.value = false
}

async function handleResend() {
  const user = auth.currentUser
  if (!user) return
  resendDisabled.value = true
  try {
    await sendEmailVerification(user, {
      url: window.location.origin + '/login'
    })
    setFeedback('ok', '인증 메일을 재전송했습니다.')
    startCountdown(RESEND_COOLDOWN)
  } catch (e: any) {
    if (e.code === 'auth/too-many-requests') {
      setFeedback('fail', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.')
      startCountdown(RESEND_COOLDOWN)
    } else {
      setFeedback('fail', '재전송에 실패했습니다. 다시 시도해주세요.')
      resendDisabled.value = false
    }
  }
}

function startCountdown(seconds: number) {
  if (countdownTimer) clearInterval(countdownTimer)
  countdown.value      = seconds
  resendDisabled.value = true
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(countdownTimer!)
      countdown.value      = 0
      resendDisabled.value = false
    }
  }, 1000)
}

function setFeedback(type: 'ok' | 'fail', msg: string) {
  feedbackType.value = type
  feedbackMsg.value  = msg
}

async function handleLogout() {
  if (pollTimer)      clearInterval(pollTimer)
  if (countdownTimer) clearInterval(countdownTimer)
  await signOut(auth)
  sessionStorage.removeItem('pendingEmail')
  router.push('/login')
}
</script>

<template>
  <div class="split-container">
    <!-- Left: Brand Panel -->
    <div class="brand-panel">
      <div class="brand-logo">A-<span class="accent">Check</span></div>
      <div class="brand-body">
        <div class="brand-badge">Email Verify</div>
        <h1 class="brand-headline">
          거의 다<br>
          왔어요<span class="highlight">!</span>
        </h1>
        <p class="brand-sub">
          이메일 인증 한 단계만 완료하면<br>
          에이체크의 모든 기능을 사용할 수 있어요.
        </p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">📨</div>
            <div class="feature-text">
              <strong>메일함을 열어주세요</strong>
              A-Check에서 보낸 인증 메일을 확인하세요
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔗</div>
            <div class="feature-text">
              <strong>링크 클릭</strong>
              메일 안의 "이메일 주소 인증" 버튼을 클릭하세요
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">✅</div>
            <div class="feature-text">
              <strong>자동으로 이동</strong>
              인증 완료 시 앱이 자동으로 메인 화면으로 이동해요
            </div>
          </div>
        </div>
      </div>
      <div class="brand-footer">© 2025 A-Check. All rights reserved.</div>
    </div>

    <!-- Right: Verify Panel -->
    <div class="form-panel">
      <div class="form-inner">
        <div class="verify-icon">✉️</div>
        <h2 class="verify-title">이메일을 확인해주세요</h2>
        <p class="verify-sub">
          아래 주소로 인증 링크를 보냈습니다.<br>
          스팸함도 꼭 확인해보세요.
        </p>
        <span class="verify-email-display">{{ emailDisplay }}</span>

        <div class="poll-status">
          <div class="poll-dot"></div>
          <span>{{ pollText }}</span>
        </div>

        <div class="verify-actions">
          <button
            class="btn-check-verify"
            type="button"
            :disabled="checkLoading"
            @click="handleCheckBtn"
          >
            {{ checkLoading ? '확인 중…' : '인증 완료 확인' }}
          </button>

          <div class="resend-row">
            <span>메일을 받지 못하셨나요?</span>
            <button
              class="btn-resend"
              type="button"
              :disabled="resendDisabled"
              @click="handleResend"
            >재전송</button>
            <span v-if="countdown > 0" class="resend-countdown">({{ countdown }}초 후 가능)</span>
          </div>

          <div v-if="feedbackMsg" class="feedback-msg" :class="feedbackType">
            {{ feedbackMsg }}
          </div>
        </div>

        <div class="divider-row"><span>또는</span></div>

        <button class="btn-logout-link" type="button" @click="handleLogout">
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  </div>
</template>
