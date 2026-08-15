import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { SuppliersService } from './suppliers.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @RequirePerms('suppliers.view')
  @Get()
  list(@Query() q: PaginationDto) {
    return this.service.list(q)
  }

  @RequirePerms('suppliers.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('suppliers.edit')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body)
  }

  @RequirePerms('suppliers.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body)
  }

  @RequirePerms('suppliers.edit')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
