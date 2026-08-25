import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import COS = require('cos-nodejs-sdk-v5')

const COS_URL_PREFIX = 'cos://'
const DEFAULT_EXPIRES_SECONDS = 3600

@Injectable()
export class CosObjectUrlService {
  private readonly bucket: string
  private readonly region: string
  private readonly expires: number
  private readonly client: COS | null

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('TENCENT_COS_BUCKET')?.trim() || ''
    this.region = config.get<string>('TENCENT_COS_REGION')?.trim() || ''
    const secretId = config.get<string>('TENCENT_COS_SECRET_ID')?.trim() || ''
    const secretKey = config.get<string>('TENCENT_COS_SECRET_KEY')?.trim() || ''
    const securityToken = config.get<string>('TENCENT_COS_SESSION_TOKEN')?.trim() || undefined
    const configuredExpires = Number(config.get<string>('TENCENT_COS_URL_EXPIRES_SECONDS'))
    this.expires = Number.isFinite(configuredExpires) && configuredExpires > 0
      ? Math.min(Math.floor(configuredExpires), 86400)
      : DEFAULT_EXPIRES_SECONDS
    this.client = secretId && secretKey
      ? new COS({ SecretId: secretId, SecretKey: secretKey, SecurityToken: securityToken })
      : null
  }

  resolve(url: string): string {
    if (!url.startsWith(COS_URL_PREFIX)) return url
    const key = url.slice(COS_URL_PREFIX.length).replace(/^\/+/, '')
    if (!key || !this.client || !this.bucket || !this.region) return ''
    return this.client.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Sign: true,
      Method: 'GET',
      Expires: this.expires,
      Protocol: 'https:',
    })
  }
}
