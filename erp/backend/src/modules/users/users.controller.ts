import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto, UpdateUserDto } from './dto/user.dto'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePerms('permissions.view')
  @Get('roles')
  roles() {
    return this.usersService.roles()
  }

  @RequirePerms('permissions.view')
  @Get()
  list(@Query() q: PaginationDto & { roleCode?: string }) {
    return this.usersService.list(q)
  }

  @RequirePerms('permissions.view')
  @Get(':id/permissions')
  getPermissions(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getPermissions(id)
  }

  @RequirePerms('permissions.manage')
  @Put(':id/permissions')
  setPermissions(@Param('id', ParseIntPipe) id: number, @Body() body: { permissions?: string[] }) {
    return this.usersService.setPermissions(id, body?.permissions || [])
  }

  @RequirePerms('permissions.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.detail(id)
  }

  @RequirePerms('permissions.manage')
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto)
  }

  @RequirePerms('permissions.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto)
  }

  @RequirePerms('permissions.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id)
  }
}
