import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { UsersService } from './users.service'

jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-password') }))

describe('UsersService.create', () => {
  const create = jest.fn()
  const service = new UsersService({ sysUser: { create } } as any, {} as any)
  const dto = {
    username: 'huangyuhan',
    password: '123456',
    realName: '黄钰涵',
    roleCode: 'purchaser',
  }

  beforeEach(() => {
    create.mockReset()
    jest.mocked(bcrypt.hash).mockClear()
  })

  it('returns a clear conflict when the username unique constraint is violated', async () => {
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `sys_user_username_key`',
      { code: 'P2002', clientVersion: '5.20.0', meta: { target: 'sys_user_username_key' } },
    ))

    const result = service.create(dto)
    await expect(result).rejects.toThrow(ConflictException)
    await expect(result).rejects.toThrow('登录名已存在')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('preserves unrelated database errors', async () => {
    const error = new Error('database unavailable')
    create.mockRejectedValue(error)

    await expect(service.create(dto)).rejects.toBe(error)
  })
})
