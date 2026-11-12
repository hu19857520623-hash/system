/** Stable service codes. Snapshot the name on each deal; never infer codes for legacy shop types. */
export declare const DEAL_SERVICES: readonly [{
    readonly code: "A1";
    readonly name: "跨境店";
    readonly group: "A 类服务";
}, {
    readonly code: "A2";
    readonly name: "跨境店＋代操作其他平台链接";
    readonly group: "A 类服务";
}, {
    readonly code: "A3";
    readonly name: "跨境店＋平台链接＋代收回款（1%）";
    readonly group: "A 类服务";
}, {
    readonly code: "A4";
    readonly name: "跨境本土店（代收回款 1%）";
    readonly group: "A 类服务";
}, {
    readonly code: "A5";
    readonly name: "跨境本土店（南非公司注册＋公户，XT 回款）";
    readonly group: "A 类服务";
}, {
    readonly code: "A6";
    readonly name: "纯本土店";
    readonly group: "A 类服务";
}, {
    readonly code: "B1";
    readonly name: "跨境店";
    readonly group: "B 类服务";
}, {
    readonly code: "B2";
    readonly name: "本土店";
    readonly group: "B 类服务";
}, {
    readonly code: "C1";
    readonly name: "货盘使用押金";
    readonly group: "货盘服务";
}, {
    readonly code: "C2";
    readonly name: "货盘首充金额";
    readonly group: "货盘服务";
}, {
    readonly code: "D1";
    readonly name: "南非公司注册";
    readonly group: "公司与公户";
}, {
    readonly code: "D2";
    readonly name: "南非公户办理";
    readonly group: "公司与公户";
}, {
    readonly code: "D3";
    readonly name: "自有南非公司单下本土店";
    readonly group: "公司与公户";
}, {
    readonly code: "F1";
    readonly name: "TM 标";
    readonly group: "商标服务";
}, {
    readonly code: "F2";
    readonly name: "R 标";
    readonly group: "商标服务";
}, {
    readonly code: "G1";
    readonly name: "LOA 认证";
    readonly group: "认证服务";
}, {
    readonly code: "G2";
    readonly name: "ICASA 认证";
    readonly group: "认证服务";
}, {
    readonly code: "G3";
    readonly name: "SABS 认证";
    readonly group: "认证服务";
}, {
    readonly code: "H1";
    readonly name: "Takealot 教培陪跑";
    readonly group: "教培陪跑";
}];
export declare function findDealService(code: unknown): {
    readonly code: "A1";
    readonly name: "跨境店";
    readonly group: "A 类服务";
} | {
    readonly code: "A2";
    readonly name: "跨境店＋代操作其他平台链接";
    readonly group: "A 类服务";
} | {
    readonly code: "A3";
    readonly name: "跨境店＋平台链接＋代收回款（1%）";
    readonly group: "A 类服务";
} | {
    readonly code: "A4";
    readonly name: "跨境本土店（代收回款 1%）";
    readonly group: "A 类服务";
} | {
    readonly code: "A5";
    readonly name: "跨境本土店（南非公司注册＋公户，XT 回款）";
    readonly group: "A 类服务";
} | {
    readonly code: "A6";
    readonly name: "纯本土店";
    readonly group: "A 类服务";
} | {
    readonly code: "B1";
    readonly name: "跨境店";
    readonly group: "B 类服务";
} | {
    readonly code: "B2";
    readonly name: "本土店";
    readonly group: "B 类服务";
} | {
    readonly code: "C1";
    readonly name: "货盘使用押金";
    readonly group: "货盘服务";
} | {
    readonly code: "C2";
    readonly name: "货盘首充金额";
    readonly group: "货盘服务";
} | {
    readonly code: "D1";
    readonly name: "南非公司注册";
    readonly group: "公司与公户";
} | {
    readonly code: "D2";
    readonly name: "南非公户办理";
    readonly group: "公司与公户";
} | {
    readonly code: "D3";
    readonly name: "自有南非公司单下本土店";
    readonly group: "公司与公户";
} | {
    readonly code: "F1";
    readonly name: "TM 标";
    readonly group: "商标服务";
} | {
    readonly code: "F2";
    readonly name: "R 标";
    readonly group: "商标服务";
} | {
    readonly code: "G1";
    readonly name: "LOA 认证";
    readonly group: "认证服务";
} | {
    readonly code: "G2";
    readonly name: "ICASA 认证";
    readonly group: "认证服务";
} | {
    readonly code: "G3";
    readonly name: "SABS 认证";
    readonly group: "认证服务";
} | {
    readonly code: "H1";
    readonly name: "Takealot 教培陪跑";
    readonly group: "教培陪跑";
} | undefined;
export declare function dealServiceLabel(deal: {
    serviceCode?: string | null;
    serviceName?: string | null;
    productDesc?: string | null;
}): string;
