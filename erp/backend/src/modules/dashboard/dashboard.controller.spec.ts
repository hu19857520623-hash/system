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
    service.stats.mockResolvedValue({ products: 1 })
    service.announcements.mockResolvedValue([])
    service.notifications.mockResolvedValue({ total: 0, items: [], badges: {} })

    await expect(controller.stats()).resolves.toEqual({ products: 1 })
    await expect(controller.announcements()).resolves.toEqual([])
    await expect(controller.notifications()).resolves.toEqual({ total: 0, items: [], badges: {} })
  })

  it('parses trends days query and falls back on invalid input', async () => {
    service.trends.mockResolvedValue({ days: 14, series: [] })
    await controller.trends('14')
    expect(service.trends).toHaveBeenCalledWith(14)

    service.trends.mockResolvedValue({ days: 7, series: [] })
    await controller.trends('not-a-number')
    expect(service.trends).toHaveBeenCalledWith(7)

    await controller.trends(undefined)
    expect(service.trends).toHaveBeenCalledWith(7)
  })
})
