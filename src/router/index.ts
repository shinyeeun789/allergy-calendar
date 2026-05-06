import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'main',
      component: () => import('@/views/MainView.vue'),
      meta: { requiresAuth: true, requiresVerified: true }
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true }
    },
    {
      path: '/signup',
      name: 'signup',
      component: () => import('@/views/SignupView.vue'),
      meta: { guestOnly: true }
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: () => import('@/views/VerifyEmailView.vue')
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return '/login'
  }
  if (to.meta.requiresVerified && !auth.isEmailVerified) {
    return '/verify-email'
  }
  if (to.meta.guestOnly && auth.isAuthenticated && auth.isEmailVerified) {
    return '/'
  }
  if (to.name === 'verify-email' && !auth.isAuthenticated) {
    return '/login'
  }
  if (to.name === 'verify-email' && auth.isEmailVerified) {
    return '/'
  }
})

export default router
