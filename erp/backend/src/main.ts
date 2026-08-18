import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { json, urlencoded } from 'express'
import { AppModule } from './app.module'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { AppValidationPipe } from './common/pipes/app-validation.pipe'
import { resolveCorsOrigins } from './config/environment'

/** Base64 附件上传（POD、入库单等）需要更大的 JSON body 上限 */
const JSON_BODY_LIMIT = '20mb'

// BigInt 无法直接 JSON 序列化，统一转为 Number（ID 均在安全整数范围内）
;(BigInt.prototype as any).toJSON = function () {
  return Number(this)
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const config = app.get(ConfigService)

  app.use(json({ limit: JSON_BODY_LIMIT }))
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }))
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-DNS-Prefetch-Control', 'off')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  })
  app.setGlobalPrefix('api')
  const allowedOrigins = resolveCorsOrigins(
    config.get<string>('CORS_ORIGINS'),
    config.get<string>('NODE_ENV'),
  )
  app.enableCors({ origin: allowedOrigins, credentials: true })
  app.useGlobalPipes(new AppValidationPipe())
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new HttpExceptionFilter())

  const port = config.get<number>('PORT') || 3000
  const listenHost = String(config.get<string>('LISTEN_HOST') || '127.0.0.1').trim() || '127.0.0.1'
  await app.listen(port, listenHost)
  console.log(`🚀 ERP 后端已启动: http://${listenHost}:${port}/api`)
}
bootstrap()
