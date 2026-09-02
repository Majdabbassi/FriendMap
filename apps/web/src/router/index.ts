import { createRouter, createWebHistory } from 'vue-router'
import AuthView from '../views/AuthView.vue'
import FriendsView from '../views/FriendsView.vue'
import MapView from '../views/MapView.vue'
import SharingView from '../views/SharingView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/map' },
    { path: '/auth', component: AuthView, meta: { guest: true } },
    { path: '/map', component: MapView, meta: { requiresAuth: true } },
    { path: '/friends', component: FriendsView, meta: { requiresAuth: true } },
    { path: '/sharing', component: SharingView, meta: { requiresAuth: true } },
  ],
})

router.beforeEach((to) => {
  const authenticated = Boolean(localStorage.getItem('friendmap_token'))
  if (to.meta.requiresAuth && !authenticated) return '/auth'
  if (to.meta.guest && authenticated) return '/map'
})

export default router
