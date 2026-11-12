"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newRechargeNo = newRechargeNo;
exports.readRecharge = readRecharge;
exports.saveRecharge = saveRecharge;
exports.clearRecharge = clearRecharge;
exports.runRecharge = runRecharge;
const user_facing_error_1 = require("./user-facing-error");
const key = (scope) => {
    if (!scope)
        throw new Error('请使用原账号登录后核对充值');
    return `recharge:pending:${scope}`;
};
function newRechargeNo() {
    if (!globalThis.crypto?.getRandomValues)
        throw new Error('浏览器无法生成充值单号，请更新浏览器后重试');
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    return `RC-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 27)}`;
}
function readRecharge(storage, scope) {
    try {
        const raw = storage.getItem(key(scope));
        if (!raw)
            return null;
        const row = JSON.parse(raw);
        if (!row?.customerCode || !/^[A-Za-z0-9_-]{1,30}$/.test(row.rechargeNo) || typeof row.amount !== 'number' || !/^\d+(\.\d{1,2})?$/.test(String(row.amount)) || row.amount <= 0)
            throw new Error();
        if (row.contentChanged !== true)
            delete row.contentChanged;
        return row;
    }
    catch {
        throw new Error('原充值核对信息无法读取，请联系财务核对原充值单，勿重新充值');
    }
}
function saveRecharge(storage, scope, attempt) {
    const previous = readRecharge(storage, scope);
    const body = (row) => { const { contentChanged, ...rest } = row; return JSON.stringify(rest); };
    if (previous && body(previous) !== body(attempt))
        throw new Error('还有原充值待核对，请先重试原充值，勿修改金额或更换单号');
    try {
        storage.setItem(key(scope), JSON.stringify(attempt));
    }
    catch {
        throw new Error('无法保存充值核对信息，本次尚未提交，请检查浏览器存储后重试');
    }
}
function clearRecharge(storage, scope, attempt) {
    const current = readRecharge(storage, scope);
    if (current && current.rechargeNo !== attempt.rechargeNo)
        throw new Error('原充值单已变化，请重新核对');
    storage.removeItem(key(scope));
}
async function runRecharge(storage, scope, attempt, request) {
    if (typeof attempt.amount !== 'number' || !/^\d{1,12}(\.\d{1,2})?$/.test(String(attempt.amount)) || attempt.amount <= 0)
        throw new Error('请输入有效充值金额，最多两位小数');
    saveRecharge(storage, scope, attempt);
    const clear = () => { if (readRecharge(storage, scope)?.rechargeNo === attempt.rechargeNo)
        storage.removeItem(key(scope)); };
    try {
        const result = await request(attempt);
        if (result.customerCode !== attempt.customerCode || result.record.rechargeNo !== attempt.rechargeNo || result.record.amount !== attempt.amount || !Number.isFinite(result.balance))
            throw new Error('充值返回客户、单号或金额不一致');
        if (result.syncPending)
            return { result, completed: false, message: result.warning || '充值已到账，同步待核对。请重试原充值，勿再次充值' };
        clear();
        return { result, completed: true, message: '充值已到账，请查看最新余额与记录' };
    }
    catch (error) {
        const status = Number(error?.status);
        const text = `${(0, user_facing_error_1.userFacingError)(error)} ${String(error?.message || '')}`;
        const mismatch = status === 409 && (text.includes('金额、方式或备注不同') || text.includes('充值单号已被使用') || text.includes('勿另建单'));
        if (mismatch) {
            try { saveRecharge(storage, scope, { ...attempt, contentChanged: true }); } catch { /* 原充值仍在，本次页面仍可结束。 */ }
            throw new Error(`原充值单号对应的内容不同。请先核对充值记录；若本次没有入账，结束本次后再重新填写。不要修改后重试原充值。${(0, user_facing_error_1.userFacingError)(error)}`);
        }
        if ([400, 404, 422].includes(status)) {
            clear();
            throw new Error(`${(0, user_facing_error_1.userFacingError)(error)}。本次未新增充值，请重新核对`);
        }
        throw new Error(`充值结果待核对，原单已保留。请使用原账号重试原充值，勿另建单。${(0, user_facing_error_1.userFacingError)(error)}`);
    }
}
//# sourceMappingURL=recharge-workflow.js.map