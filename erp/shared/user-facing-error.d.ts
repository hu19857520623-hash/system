/** 将接口和运行时异常转换为用户可处理的中文提示；原始异常留在服务端日志。 */
export declare function userFacingError(value: unknown, status?: number, fallback?: string): string;
