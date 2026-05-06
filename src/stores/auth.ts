import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/firebase'

export const useAuthStore = defineStore('auth', () => {
  const user    = ref<User | null>(null)
  const loading = ref(true)

  const isAuthenticated = computed(() => !!user.value)
  const isEmailVerified = computed(() => user.value?.emailVerified ?? false)

  function init(): Promise<void> {
    return new Promise((resolve) => {
      onAuthStateChanged(auth, (firebaseUser) => {
        user.value    = firebaseUser
        loading.value = false
        resolve()
      })
    })
  }

  return { user, loading, isAuthenticated, isEmailVerified, init }
})
