<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail
} from 'firebase/auth'
import { auth } from '@/firebase'

const router = useRouter()

const email        = ref('')
const password     = ref('')
const errorMessage = ref('')
const submitting   = ref(false)

const showModal    = ref(false)
const modalState   = ref<'default' | 'success'>('default')
const resetEmail   = ref('')
const modalError   = ref('')
const sendingReset = ref(false)

async function handleLogin() {
  errorMessage.value = ''
  submitting.value   = true
  try {
    const result = await signInWithEmailAndPassword(auth, email.value, password.value)
    if (!result.user.emailVerified) {
      sessionStorage.setItem('pendingEmail', email.value)
      router.push('/verify-email')
    } else {
      router.push('/')
    }
  } catch {
    errorMessage.value = '이메일 또는 비밀번호가 올바르지 않습니다.'
  } finally {
    submitting.value = false
  }
}

async function handleGoogleLogin() {
  errorMessage.value = ''
  const provider = new GoogleAuthProvider()
  try {
    await signInWithPopup(auth, provider)
    router.push('/')
  } catch {
    errorMessage.value = 'Google 로그인에 실패했습니다.'
  }
}

function openModal() {
  resetEmail.value  = ''
  modalError.value  = ''
  modalState.value  = 'default'
  showModal.value   = true
}

function closeModal() {
  showModal.value = false
}

async function sendReset() {
  modalError.value = ''
  const em = resetEmail.value.trim()
  if (!em) {
    modalError.value = '이메일 주소를 입력해주세요.'
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    modalError.value = '올바른 이메일 형식이 아닙니다.'
    return
  }
  sendingReset.value = true
  try {
    await sendPasswordResetEmail(auth, em)
    modalState.value = 'success'
  } catch (err: any) {
    modalError.value = err.code === 'auth/user-not-found'
      ? '해당 이메일로 가입된 계정이 없습니다.'
      : '이메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요.'
  } finally {
    sendingReset.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showModal.value) closeModal()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="split-container">
    <!-- Left: Brand Panel -->
    <div class="brand-panel">
      <div class="brand-logo">A-<span class="accent">Check</span></div>
      <div class="brand-body">
        <div class="brand-badge">Health Diary</div>
        <h1 class="brand-headline">
          나의 일상을<br>
          <span class="highlight">건강하게</span><br>
          기록하세요
        </h1>
        <p class="brand-sub">
          알레르기 반응부터 일상 건강 상태까지,<br>
          A-Check와 함께 체계적으로 관리하세요.
        </p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">📋</div>
            <div class="feature-text">
              <strong>일일 건강 기록</strong>
              매일의 증상과 컨디션을 손쉽게 입력
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">📊</div>
            <div class="feature-text">
              <strong>패턴 분석</strong>
              달력 뷰로 알레르기 패턴을 한눈에 파악
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔔</div>
            <div class="feature-text">
              <strong>스마트 알림</strong>
              기록 시간과 복약 일정을 놓치지 않도록
            </div>
          </div>
        </div>
      </div>
      <div class="brand-footer">© 2025 A-Check. All rights reserved.</div>
    </div>

    <!-- Right: Form Panel -->
    <div class="form-panel">
      <div class="form-inner">
        <div class="form-header">
          <h2>다시 만나요 👋</h2>
          <p>계정에 로그인하여 건강 기록을 이어가세요.</p>
        </div>

        <button class="btn-google" type="button" @click="handleGoogleLogin">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
          Google로 계속하기
        </button>

        <div class="divider"><span>또는 이메일로 로그인</span></div>

        <form @submit.prevent="handleLogin">
          <div class="input-group">
            <label for="email">이메일 주소</label>
            <input type="email" id="email" v-model="email" placeholder="email@example.com" required>
          </div>
          <div class="input-group">
            <label for="password">비밀번호</label>
            <input type="password" id="password" v-model="password" placeholder="••••••••" required>
          </div>
          <div v-if="errorMessage" class="error-text">{{ errorMessage }}</div>
          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? '로그인 중…' : '로그인' }}
          </button>
        </form>

        <div class="action-links">
          <a href="#" @click.prevent="openModal">비밀번호 찾기</a>
          <div class="sep"></div>
          <RouterLink to="/signup">회원가입</RouterLink>
        </div>
      </div>
    </div>
  </div>

  <!-- 비밀번호 찾기 모달 -->
  <div
    class="modal-backdrop"
    :class="{ open: showModal }"
    role="dialog"
    aria-modal="true"
    @click.self="closeModal"
  >
    <div class="modal-card">
      <!-- 기본 상태 -->
      <div v-if="modalState === 'default'">
        <div class="modal-icon">🔐</div>
        <h3 class="modal-title">비밀번호 재설정</h3>
        <p class="modal-desc">
          가입하신 이메일 주소를 입력하면<br>재설정 링크를 보내드립니다.
        </p>
        <div class="modal-input-group">
          <label for="reset-email">이메일 주소</label>
          <input
            type="email"
            id="reset-email"
            v-model="resetEmail"
            placeholder="email@example.com"
            autocomplete="email"
            @keydown.enter="sendReset"
          >
          <div v-if="modalError" class="modal-error">{{ modalError }}</div>
        </div>
        <button class="btn-primary modal-btn" type="button" @click="sendReset" :disabled="sendingReset">
          {{ sendingReset ? '전송 중…' : '재설정 링크 보내기' }}
        </button>
        <button class="modal-cancel" type="button" @click="closeModal">취소</button>
      </div>

      <!-- 성공 상태 -->
      <div v-else>
        <div class="modal-icon success">✉️</div>
        <h3 class="modal-title">이메일을 확인하세요</h3>
        <p class="modal-desc">
          <strong>{{ resetEmail }}</strong><br>
          으로 재설정 링크를 보냈습니다.<br>
          <span class="modal-desc-sub">스팸함도 꼭 확인해주세요.</span>
        </p>
        <button class="btn-primary modal-btn" type="button" @click="closeModal">확인</button>
      </div>

      <button class="modal-x" type="button" aria-label="닫기" @click="closeModal">✕</button>
    </div>
  </div>
</template>
