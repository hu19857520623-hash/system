type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type RechargeAttempt = {
    customerCode: string;
    customerId?: number;
    customerName?: string;
    rechargeNo: string;
    amount: number;
    paymentMethod?: string;
    paymentMethodId?: string;
    paymentMethodTitle?: string;
    remark?: string;
    contentChanged?: boolean;
};
export declare function newRechargeNo(): string;
export declare function readRecharge(storage: StoragePort, scope: string): RechargeAttempt | null;
export declare function saveRecharge(storage: StoragePort, scope: string, attempt: RechargeAttempt): void;
export declare function clearRecharge(storage: StoragePort, scope: string, attempt: RechargeAttempt): void;
export declare function runRecharge<T extends {
    record: {
        rechargeNo: string;
        amount: number;
    };
    customerCode: string;
    balance: number;
    syncPending?: boolean;
    warning?: string;
}>(storage: StoragePort, scope: string, attempt: RechargeAttempt, request: (attempt: RechargeAttempt) => Promise<T>): Promise<{
    result: T;
    completed: boolean;
    message: string;
}>;
export {};
