import { ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common'

const queryPipe = new ValidationPipe({
  whitelist: false,
  transform: true,
  forbidNonWhitelisted: false,
  transformOptions: { enableImplicitConversion: true },
})

/**
 * Body 仍做 whitelist，避免多余字段写入。
 * Query/Param 不能 whitelist：`PaginationDto & { status }` 运行时只剩 PaginationDto，
 * 会把 status、followDue、roleCode 等筛选参数剥掉，列表页看起来像「没接口」。
 */
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({ whitelist: true, transform: true, forbidNonWhitelisted: false })
  }

  override transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'query' || metadata.type === 'param') {
      return queryPipe.transform(value, metadata)
    }
    return super.transform(value, metadata)
  }
}
