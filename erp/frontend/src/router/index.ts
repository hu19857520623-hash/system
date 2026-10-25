import { createRouter, createWebHistory } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { routes } from './routes'
import { createErpRouteGuard } from './routeAccess'

const router = createRouter({ history: createWebHistory(), routes })
router.beforeEach(createErpRouteGuard(useAppStore))

export default router
