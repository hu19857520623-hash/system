declare module 'qrcode' {
  export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

  export interface QrCode {
    modules: {
      size: number
      get(row: number, column: number): boolean
    }
  }

  export function create(value: string, options?: { errorCorrectionLevel?: ErrorCorrectionLevel }): QrCode
}
