import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisJsonCache } from './redis-json-cache'

@Injectable()
export class CacheService extends RedisJsonCache implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const logger = new Logger('RedisCache')
    super(Object.fromEntries([
      'NODE_ENV', 'REDIS_CACHE_ENABLED', 'REDIS_CACHE_PREFIX',
      'REDIS_HOST', 'REDIS_PORT', 'REDIS_USERNAME', 'REDIS_PASSWORD',
    ].map(key => [key, config.get<string>(key)])), message => logger.warn(message))
  }

  onModuleDestroy() { this.close() }
}
