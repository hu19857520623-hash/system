import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = '服务器内部错误'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const res = exception.getResponse() as any
      message = typeof res === 'string' ? res : res?.message || exception.message
      if (Array.isArray(message)) message = message.join('; ')
    } else if (exception instanceof Error) {
      message = exception.message
      this.logger.error(exception.message, exception.stack)
    }

    response.status(status).json({ code: status, message, data: null })
  }
}
