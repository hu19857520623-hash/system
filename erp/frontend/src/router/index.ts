import { createLiveAccess } from '@/auth/liveAccess'
import { getAccessToken } from '@/auth/tokenStore'
import { createRouter, createWebHistory } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { routes } from './routes'
import { createErpRouteGuard } from './routeAccess'

const router = createRouter({ history: createWebHistory(), routes })
export const liveAccess = createLiveAccess(router, useAppStore, getAccessToken)
router.beforeEach(createErpRouteGuard(useAppStore, liveAccess.refresh))

export default router
