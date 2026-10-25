import { ConfigService } from '@nestjs/config'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { JwtStrategy } from './jwt.strategy'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { PERMS_KEY } from '../../common/decorators/require-perms.decorator'

function fixture(user:any={id:7n,username:'current-user',realName:'当前财务',roleCode:'finance',status:1}) {
  const prisma:any={sysUser:{findUnique:jest.fn().mockResolvedValue(user)},sysUserPermission:{findMany:jest.fn().mockResolvedValue([])},sysRolePermission:{findMany:jest.fn().mockResolvedValue([])}}
  const strategy=new JwtStrategy(new ConfigService({JWT_SECRET:'unit-test-key-not-a-live-secret'}),prisma)
  return {strategy,prisma}
}
describe('通用JWT使用当前有效账号，旧岗位不能延续权限',()=>{
  it('管理员已降为财务时返回当前岗位和姓名，通用管理接口不再走旧admin捷径',async()=>{
    const {strategy,prisma}=fixture()
    const user=await strategy.validate({sub:7,username:'old-admin',roleCode:'admin',realName:'旧管理员'})
    expect(user).toEqual({userId:7,username:'current-user',roleCode:'finance',realName:'当前财务'})
    expect(prisma.sysUser.findUnique).toHaveBeenCalledWith({where:{id:7n},select:{id:true,username:true,realName:true,roleCode:true,status:true}})
    const guard=new PermissionsGuard({getAllAndOverride:(key:string)=>key===PERMS_KEY?['permissions.view']:undefined} as any,new PermissionsService(prisma))
    const context={getHandler:()=>({}),getClass:()=>({}),switchToHttp:()=>({getRequest:()=>({user})})} as any
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)
  })
  it.each([null,{id:7n,roleCode:'admin',status:0},{id:7n,roleCode:'admin',status:2}])('账号停用或删除时旧管理员令牌也返回中文401 %p',async user=>{
    const {strategy}=fixture(user)
    await expect(strategy.validate({sub:7,roleCode:'admin'})).rejects.toThrow('账号已停用或不存在')
    await expect(strategy.validate({sub:7,roleCode:'admin'})).rejects.toBeInstanceOf(UnauthorizedException)
  })
  it('每次请求重新读取账号，活跃令牌可以跟随当前岗位但不能缓存旧权限',async()=>{
    const {strategy,prisma}=fixture()
    expect((await strategy.validate({sub:'7',roleCode:'admin'})).roleCode).toBe('finance')
    prisma.sysUser.findUnique.mockResolvedValueOnce({id:7n,username:'current-user',realName:'当前仓库',roleCode:'warehouse',status:1})
    expect((await strategy.validate({sub:7,roleCode:'admin'})).roleCode).toBe('warehouse')
    expect(prisma.sysUser.findUnique).toHaveBeenCalledTimes(2)
  })
  it.each([undefined,null,true,0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1,'','7.0','7e0','-7','bad',{}])('无效账号标识%s在BigInt或数据库查询前返回中文登录提示',async sub=>{
    const {strategy,prisma}=fixture()
    await expect(strategy.validate({sub})).rejects.toThrow('登录信息无效，请重新登录')
    expect(prisma.sysUser.findUnique).not.toHaveBeenCalled()
  })
})
