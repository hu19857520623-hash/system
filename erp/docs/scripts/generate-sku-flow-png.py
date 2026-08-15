"""Generate SKU lifecycle flow diagram PNG (creation -> customer purchase)."""
from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = Path(__file__).resolve().parents[1] / "images" / "sku-lifecycle-flow.png"
OUT.parent.mkdir(parents=True, exist_ok=True)

for font in ("Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC", "Arial Unicode MS"):
    try:
        plt.rcParams["font.sans-serif"] = [font]
        break
    except Exception:
        pass
plt.rcParams["axes.unicode_minus"] = False

# (num, title, role, desc, customer_tag)
# customer_tag: None | "visible" | "orderable"
STEPS = [
    ("1", "新建选品申请", "产品开发", "填写链接、采购价、尺寸、售价等", None),
    ("2", "提交选品审核", "产品开发", "提交至产品审核队列", None),
    ("3", "产品审核通过", "产品开发主管", "核定计划采购量 · 自动生成 SKU · 自动生成预采购单", None),
    ("4", "分配采购员", "采购主管", "预采购单 → 指定采购员", None),
    ("5", "编辑预采购单", "采购", "完善供应商、单价、国内运费、目标中转仓等", None),
    ("6", "确认预采购", "采购", "生成正式采购单（待核定实际数量）", None),
    ("6'", "直接创建采购单", "采购", "可选路径：跳过预采购，直接创建正式采购单", None),
    ("7", "核定实际采购数量", "产品开发主管", "填写实际采购数量 → 进入采购审核", None),
    ("8", "采购主管审核", "采购主管", "审核 PO → 待财务审核", None),
    ("9", "财务审核", "财务", "审核通过 · 同步商品主数据 · 写入货盘成本（客户尚不可见）", None),
    ("10", "国内中转仓收货", "采购 / 采购主管", "物流中转仓登记到货 · 更新 PO 收货状态", None),
    ("11", "创建发海外仓入库单", "采购", "从中转仓可用库存创建 IN 单 · 分摊海运费", None),
    ("12", "海运费回传", "采购 / 采购主管", "入库单海运费分摊回传 · 货盘进入「待定价」", None),
    ("13", "海外仓到仓扫描", "仓库", "扫描入库单 / 箱唛 · 状态：已到仓", None),
    ("14", "开始收货", "仓库", "确认开始收货作业", None),
    ("15", "清点 / 质检", "仓库", "核对 SKU 数量 · 良品/不良品登记", None),
    ("16", "上架入库", "仓库", "分配库位 · 写入海外仓可用库存", None),
    ("17", "确认货盘售价", "产品开发主管 / 陪跑", "货盘定价页确认市场参考价与最终售价", None),
    ("18", "同步 OMS", "陪跑", "售价推送至 OMS · 海外仓已有库存", "visible"),
]

ROLE_COLORS = {
    "产品开发": "#2563eb",
    "产品开发主管": "#7c3aed",
    "采购主管": "#0d9488",
    "采购": "#0891b2",
    "财务": "#ca8a04",
    "采购 / 采购主管": "#0f766e",
    "仓库": "#ea580c",
    "产品开发主管 / 陪跑": "#9333ea",
    "陪跑": "#db2777",
    "客户 (OMS)": "#f43f5e",
}

CUSTOMER_TAGS = {
    "visible": ("★ 客户里程碑", "客户在 OMS 货盘可见商品 · 海外仓已有库存，可下单购买"),
    "orderable": ("★ 客户里程碑", "海外仓有可用库存 · 客户在 OMS 可下单购买"),
}

fig_w, fig_h = 14, 27
fig, ax = plt.subplots(figsize=(fig_w, fig_h), facecolor="#0f172a")
ax.set_facecolor("#0f172a")
ax.set_xlim(0, 14)
ax.set_ylim(0, 27)
ax.axis("off")

ax.text(7, 26.2, "SKU 全链路流程", ha="center", va="center", fontsize=28, color="#f8fafc", fontweight="bold")
ax.text(7, 25.55, "从选品创建 → 海外仓入库 → 客户在 OMS 可见/可购 · 各步骤操作人员", ha="center", va="center", fontsize=12.5, color="#94a3b8")

legend_y = 25.05
ax.text(0.6, legend_y, "内部角色：", fontsize=9.5, color="#cbd5e1", fontweight="bold")
lx = 2.1
for role, color in list(ROLE_COLORS.items())[:-1]:
    ax.add_patch(FancyBboxPatch((lx, legend_y - 0.16), 0.32, 0.24, boxstyle="round,pad=0.02", facecolor=color, edgecolor="none"))
    ax.text(lx + 0.42, legend_y - 0.04, role, fontsize=8.2, color="#e2e8f0", va="center")
    lx += 1.35 if len(role) <= 4 else 1.85 if len(role) <= 7 else 2.35

ax.add_patch(FancyBboxPatch((lx, legend_y - 0.16), 0.32, 0.24, boxstyle="round,pad=0.02", facecolor="#f43f5e", edgecolor="none"))
ax.text(lx + 0.42, legend_y - 0.04, "客户 (OMS)", fontsize=8.2, color="#fecdd3", va="center")

box_w = 12.2
box_h = 0.92
x0 = 0.9
y = 23.7
gap = 0.24

for i, (num, title, role, desc, customer_tag) in enumerate(STEPS):
    color = ROLE_COLORS.get(role, "#64748b")
    is_alt = num.endswith("'")
    is_customer = customer_tag is not None

    if is_customer:
        face = "#2a1520" if customer_tag == "visible" else "#1a2e1f"
        edge = "#f43f5e" if customer_tag == "visible" else "#22c55e"
        lw = 2.4
    elif is_alt:
        face, edge, lw = "#172033", "#475569", 1.2
    else:
        face, edge, lw = "#1e293b", color, 1.8

    patch = FancyBboxPatch(
        (x0, y - box_h), box_w, box_h,
        boxstyle="round,pad=0.03,rounding_size=0.08",
        facecolor=face, edgecolor=edge, linewidth=lw,
        linestyle="--" if is_alt else "-",
    )
    ax.add_patch(patch)

    badge_color = "#f43f5e" if is_customer else color
    badge = FancyBboxPatch((x0 + 0.15, y - box_h + 0.17), 0.55, 0.55, boxstyle="round,pad=0.02", facecolor=badge_color, edgecolor="none")
    ax.add_patch(badge)
    ax.text(x0 + 0.42, y - box_h + 0.45, num.replace("'", "备"), ha="center", va="center", fontsize=10.5, color="white", fontweight="bold")

    ax.text(x0 + 0.95, y - 0.27, title, ha="left", va="center", fontsize=13, color="#f1f5f9", fontweight="bold")

    if is_customer:
        tag_title, tag_desc = CUSTOMER_TAGS[customer_tag]
        ax.text(x0 + 0.95, y - 0.58, tag_desc, ha="left", va="center", fontsize=9.5, color="#fda4af" if customer_tag == "visible" else "#86efac")
        ax.text(x0 + box_w - 0.25, y - 0.42, "客户 (OMS)", ha="right", va="center", fontsize=11, color="#f43f5e" if customer_tag == "visible" else "#22c55e", fontweight="bold")
        ax.text(x0 + box_w - 0.25, y - 0.68, role, ha="right", va="center", fontsize=9.5, color=color)
    else:
        ax.text(x0 + 0.95, y - 0.6, desc, ha="left", va="center", fontsize=9.5, color="#94a3b8")
        ax.text(x0 + box_w - 0.25, y - 0.45, role, ha="right", va="center", fontsize=11, color=color, fontweight="bold")

    if i < len(STEPS) - 1:
        next_alt = STEPS[i + 1][0].endswith("'")
        if not is_alt and not next_alt:
            arrow = FancyArrowPatch(
                (7, y - box_h - 0.02), (7, y - box_h - gap + 0.02),
                arrowstyle="-|>", mutation_scale=11, linewidth=1.4, color="#64748b",
            )
            ax.add_patch(arrow)
        elif is_alt:
            ax.text(x0 + 0.95, y - box_h - 0.1, "-> 与步骤 7 汇合", fontsize=8.5, color="#64748b")

    y -= box_h + gap

phases = [
    (23.7, 20.8, "选品\n立项"),
    (20.5, 16.2, "采购\n审批"),
    (15.9, 12.0, "国内\n中转"),
    (11.7, 6.8, "海外仓\n入库"),
    (6.4, 0.8, "货盘\n客户"),
]
for y_top, y_bot, label in phases:
    mid = (y_top + y_bot) / 2
    ax.plot([0.35, 0.35], [y_bot, y_top], color="#334155", linewidth=3, solid_capstyle="round")
    ax.text(0.35, mid, label, ha="center", va="center", fontsize=8.5, color="#64748b", rotation=90)

ax.text(7, 0.35, "TKL 海外仓 ERP · 先完成海外仓上架入库，再确认售价并同步 OMS；同步后客户可见且可下单", ha="center", va="center", fontsize=8.5, color="#475569")

fig.savefig(OUT, dpi=180, bbox_inches="tight", facecolor=fig.get_facecolor(), pad_inches=0.25)
print(f"Saved: {OUT}")
