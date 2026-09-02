import { DashboardController } from './dashboard.controller'

describe('DashboardController', () => {
  const service = {
    stats: jest.fn(),
    trends: jest.fn(),
    announcements: jest.fn(),
    notifications: jest.fn(),
  }
  const controller = new DashboardController(service as any)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delegates stats/announcements/notifications', async () => {
    const user = { userId: 1, roleCode: 'cs' }
    service.stats.mockResolvedValue({ leads: 1 })
    service.announcements.mockResolvedValue([])
    service.notifications.mockResolvedValue({ total: 0, items: [], badges: {} })

    await expect(controller.stats(user as any)).resolves.toEqual({ leads: 1 })
    await expect(controller.announcements()).resolves.toEqual([])
    await expect(controller.notifications()).resolves.toEqual({ total: 0, items: [], badges: {} })
  })

  it('parses trends days query and falls back on invalid input', async () => {
    const user = { userId: 1, roleCode: 'admin' }
    service.trends.mockResolvedValue({ days: 14, series: [] })
    await controller.trends('14', user as any)
    expect(service.trends).toHaveBeenCalledWith(14, user.userId, user.roleCode)

    service.trends.mockResolvedValue({ days: 7, series: [] })
    await controller.trends('not-a-number', user as any)
    expect(service.trends).toHaveBeenCalledWith(7, user.userId, user.roleCode)

    await controller.trends(undefined, user as any)
    expect(service.trends).toHaveBeenCalledWith(7, user.userId, user.roleCode)
  })
})
