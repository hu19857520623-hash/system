import { ConfigService } from '@nestjs/config'
import { MingruiClient } from './mingrui.client'

describe('MingruiClient', () => {
  function client(env: Record<string, string> = {}, fetchImpl?: jest.Mock) {
    const config = { get: (key: string) => env[key] } as ConfigService
    return new MingruiClient(config, (fetchImpl || jest.fn()) as unknown as typeof fetch)
  }

  function jsonResponse(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }
  }

  it('reports not configured when env is empty', async () => {
    const c = client()
    expect(c.isConfigured()).toBe(false)
    const booking = await c.createBooking({ shipmentNo: 'MR1', mode: 'lcl' })
    expect(booking.ok).toBe(false)
    expect(booking.configured).toBe(false)
    expect(booking.message).toContain('尚未接入')
  })

  it('requires both appKey and appToken before calling AI-OPS', async () => {
    const fetchImpl = jest.fn()
    const c = client({ MINGRUI_APP_KEY: 'key-only' }, fetchImpl)
    expect(c.isConfigured()).toBe(false)
    await c.queryTracking({ shipmentNo: 'MR1', mingruiOrderNo: 'SEAE1' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks for a job number or tracking ref before querying', async () => {
    const fetchImpl = jest.fn()
    const c = client({ MINGRUI_APP_KEY: 'k', MINGRUI_APP_TOKEN: 't' }, fetchImpl)
    const tracking = await c.queryTracking({ shipmentNo: 'MR1' })
    expect(tracking.ok).toBe(false)
    expect(tracking.message).toContain('工作号')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('loads shipment then tracking nodes from AI-OPS', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('getOneShipment')) {
        return jsonResponse({
          code: '0',
          message: 'success',
          data: {
            jobNum: 'SEAE260713941',
            trackingRef: 'TKL-220',
            status: 'IN_TRANSIT',
            origin: { city: '深圳' },
            destination: 'Durban',
            etd: '2026-08-20T00:00:00+08:00',
            eta: '2026-09-05T00:00:00+08:00',
            weight: 1200.5,
            volume: 8.6,
            packages: [{ quantity: 10, packageType: 'CARTON' }],
            references: [
              { type: 'BL', value: 'EGLV123' },
              { type: 'CONTAINER', value: 'MRSU1234567' },
            ],
            vesselName: 'EXAMPLE STAR',
          },
        })
      }
      return jsonResponse({
        code: '0',
        message: 'success',
        data: {
          trackingRef: 'TKL-220',
          status: 'IN_TRANSIT',
          statusName: '运输中',
          nodes: [
            {
              status: 'PICKED_UP',
              statusName: '已提货',
              eventTime: '2026-08-18T09:30:00+08:00',
              location: '深圳',
              description: '货物已由承运方接收',
            },
          ],
        },
      })
    })
    const c = client({
      MINGRUI_APP_KEY: 'k',
      MINGRUI_APP_TOKEN: 't',
    }, fetchImpl)

    const tracking = await c.queryTracking({
      shipmentNo: 'MR1',
      mingruiOrderNo: 'SEAE260713941',
    })

    expect(tracking.ok).toBe(true)
    expect(tracking.mingruiOrderNo).toBe('SEAE260713941')
    expect(tracking.trackingRef).toBe('TKL-220')
    expect(tracking.trackingStatus).toBe('运输中')
    expect(tracking.localStatus).toBe('in_transit')
    expect(tracking.blNo).toBe('EGLV123')
    expect(tracking.containerNo).toBe('MRSU1234567')
    expect(tracking.originCity).toBe('深圳')
    expect(tracking.destPort).toBe('Durban')
    expect(tracking.packages).toBe(10)
    expect(tracking.weightKg).toBe(1200.5)
    expect(tracking.trackingNodes).toHaveLength(1)
    expect(tracking.trackingDetail).toContain('已提货')

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://ws.ai-ops.vip/edi/web-services/fms/v2/getOneShipment?jobNum=SEAE260713941',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          appKey: 'k',
          appToken: 't',
          Accept: 'application/json',
        }),
      }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://ws.ai-ops.vip/edi/web-services/v5/tracking?trackingRef=TKL-220',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('maps flat AI-OPS shipment and dataList tracking payloads', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('getOneShipment')) {
        return jsonResponse({
          code: '200',
          jobNum: 'SEAE260713941',
          hblNum: 'TKL-220',
          polName: 'GUANGZHOU,NANSHA',
          destName: 'DURBAN, SOUTH AFRICA',
          podName: 'DURBAN, SOUTH AFRICA',
          vsl: 'MOL EXPLORER',
          pkgs: 8,
          gw: 186,
          vol: 1.514,
          etd: '2026-08-11',
          eta: '2026-09-02',
          shipmentType: 'LCL',
          status: 'InTransit',
        })
      }
      return jsonResponse({
        code: '200',
        jobNum: 'SEAE260713941',
        status: 'InTransit',
        dataList: [
          { time: '2026-08-18 09:19', context: '船公司已开船 MOL EXPLORER / 096W', node: 'atd' },
        ],
      })
    })
    const c = client({ MINGRUI_APP_KEY: 'k', MINGRUI_APP_TOKEN: 't' }, fetchImpl)
    const tracking = await c.queryTracking({ shipmentNo: 'MR1', mingruiOrderNo: 'SEAE260713941' })
    expect(tracking.ok).toBe(true)
    expect(tracking.trackingRef).toBe('TKL-220')
    expect(tracking.blNo).toBe('TKL-220')
    expect(tracking.originCity).toBe('GUANGZHOU,NANSHA')
    expect(tracking.destPort).toBe('DURBAN, SOUTH AFRICA')
    expect(tracking.vesselName).toBe('MOL EXPLORER')
    expect(tracking.packages).toBe(8)
    expect(tracking.weightKg).toBe(186)
    expect(tracking.localStatus).toBe('in_transit')
    expect(tracking.trackingNodes?.[0]?.description).toContain('开船')
  })

  it('maps HTTP 401 to an auth error without retrying', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ message: 'unauthorized' }, 401))
    const c = client({ MINGRUI_APP_KEY: 'k', MINGRUI_APP_TOKEN: 't' }, fetchImpl)
    const tracking = await c.queryTracking({ shipmentNo: 'MR1', trackingRef: 'TKL-220' })
    expect(tracking.ok).toBe(false)
    expect(tracking.message).toContain('认证失败')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
