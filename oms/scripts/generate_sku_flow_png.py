"""Generate SKU catalog purchase-to-outbound flowchart PNG."""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

# Font setup for Chinese on Windows
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "SKU申购到出库流程图.png"

# (step_no, title, detail, color, group)
STEPS = [
    ("准备", "1. OMS 开户", "管理员开通账号，分配货盘客户权限", "#E8F4FD", False),
    ("准备", "2. 充值余额", "账户充值，用于货盘购货与履约费用预扣", "#E8F4FD", False),
    ("申购", "3. 浏览货盘", "查看 inCatalog 商品，确认 SKU 可售状态", "#FFF3E0", False),
    ("申购", "4. 申购并锁定", "purchaseCatalogProduct：扣减共享池 available\n-> 客户 locked，生成 CAT-申购单号", "#FFE0B2", True),
    ("申购", "5. 库存状态变更", "共享货盘池 available 减少 / 客户 locked 增加\n商品主数据 availableQty 减少 / lockedQty 增加", "#FFE0B2", False),
    ("编码", "6. 编码绑定（可选）", "Takealot 990/TSIN 与内部 SKU 映射", "#F3E5F5", False),
    ("外部", "7. Takealot 预约发货", "Seller Portal 预约入仓时间\n下载：外箱标 / SKU标签 / 发货清单 / 预约单", "#ECEFF1", False),
    ("出库", "8. 创建出库单", "选择出库类型/目的仓，填写 SKU 明细\n上传 Takealot 下载文件", "#E8F5E9", False),
    ("出库", "9. 库存二次锁定", "lockStockForOutbound：locked -> pendingOutbound\n校验：未申购 SKU 不可出库", "#C8E6C9", True),
    ("出库", "10. 费用预扣", "按 SKU 尺寸 + 区域模板计算操作/物流费\npreDeductOutboundFees 扣减余额", "#C8E6C9", False),
    ("出库", "11. 提交出库单", "生成 OUT-出库单号，status = 已锁库存 (locked)", "#A5D6A7", True),
    ("仓库", "12. 待处理", "出库单进入 WMS 队列，status = pending", "#E3F2FD", False),
    ("仓库", "13. 拣货中", "WMS 波次拣货，扫描 990码/内部 SKU 校验", "#BBDEFB", False),
    ("仓库", "14. 打包出库", "贴标、称重、确认发货，status = shipped", "#90CAF9", True),
    ("仓库", "15. 已签收", "送达 Takealot DC / 目的地，status = delivered", "#64B5F6", False),
    ("回传", "16. 物流单号回传", "WMS 回传 trackingNo 至 OMS\nLogisticsRecord: in_transit", "#FFF9C4", False),
    ("回传", "17. 签收单回传 (POD)", "上传 POD 签收凭证，podStatus = uploaded", "#FFF59D", False),
    ("结算", "18. 费用结算", "预扣费用确认结算，生成 FeeRecord", "#FCE4EC", False),
    ("结算", "19. 报表输出", "出库/库存/费用报表归档", "#F8BBD9", False),
]

GROUP_COLORS = {
    "准备": "#1565C0",
    "申购": "#E65100",
    "编码": "#6A1B9A",
    "外部": "#455A64",
    "出库": "#2E7D32",
    "仓库": "#0D47A1",
    "回传": "#F9A825",
    "结算": "#AD1457",
}


def draw_box(ax, x, y, w, h, title, detail, face, highlight=False):
    edge = "#FF6F00" if highlight else "#37474F"
    lw = 2.2 if highlight else 1.2
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.02,rounding_size=0.015",
        linewidth=lw,
        edgecolor=edge,
        facecolor=face,
        transform=ax.transAxes,
        zorder=2,
    )
    ax.add_patch(box)
    ax.text(
        x + w / 2,
        y + h * 0.68,
        title,
        ha="center",
        va="center",
        fontsize=11.5,
        fontweight="bold",
        color="#1A237E",
        transform=ax.transAxes,
        zorder=3,
    )
    ax.text(
        x + w / 2,
        y + h * 0.28,
        detail,
        ha="center",
        va="center",
        fontsize=8.8,
        color="#424242",
        linespacing=1.35,
        transform=ax.transAxes,
        zorder=3,
    )


def main():
    n = len(STEPS)
    fig_h = max(28, n * 1.05 + 3)
    fig, ax = plt.subplots(figsize=(14, fig_h))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    fig.patch.set_facecolor("#FAFAFA")

    # Title bar
    title_bg = FancyBboxPatch(
        (0.04, 0.965),
        0.92,
        0.028,
        boxstyle="round,pad=0.01,rounding_size=0.008",
        facecolor="#1A237E",
        edgecolor="none",
        transform=ax.transAxes,
    )
    ax.add_patch(title_bg)
    ax.text(
        0.5,
        0.979,
        "SKU 货盘申购 → 出库 全流程（货盘客户 · Takealot 入仓）",
        ha="center",
        va="center",
        fontsize=16,
        fontweight="bold",
        color="white",
        transform=ax.transAxes,
    )

    box_w = 0.72
    box_h = 0.038
    x_center = 0.5
    x_left = x_center - box_w / 2
    top_y = 0.935
    gap = 0.0045
    positions: list[tuple[float, float]] = []

    current_group = None
    group_x = 0.06

    for i, (group, title, detail, color, highlight) in enumerate(STEPS):
        y = top_y - i * (box_h + gap)
        positions.append((x_center, y + box_h / 2))

        if group != current_group:
            current_group = group
            ax.text(
                group_x,
                y + box_h / 2,
                group,
                ha="center",
                va="center",
                fontsize=10,
                fontweight="bold",
                color="white",
                bbox=dict(boxstyle="round,pad=0.35", facecolor=GROUP_COLORS[group], edgecolor="none"),
                transform=ax.transAxes,
                zorder=4,
            )

        draw_box(ax, x_left, y, box_w, box_h, title, detail, color, highlight)

    # Arrows between steps
    for i in range(len(positions) - 1):
        x1, y1 = positions[i]
        x2, y2 = positions[i + 1]
        arrow = FancyArrowPatch(
            (x1, y1 - box_h / 2 - 0.001),
            (x2, y2 + box_h / 2 + 0.001),
            arrowstyle="-|>",
            mutation_scale=12,
            linewidth=1.4,
            color="#546E7A",
            transform=ax.transAxes,
            zorder=1,
        )
        ax.add_patch(arrow)

    # Legend
    legend_y = top_y - n * (box_h + gap) - 0.02
    ax.text(
        0.5,
        legend_y,
        "橙色边框 = 关键状态变更节点    |    灰色虚线框步骤 = Takealot 外部平台操作",
        ha="center",
        va="top",
        fontsize=9,
        color="#616161",
        transform=ax.transAxes,
    )

    # Inventory state summary
    summary = (
        "库存状态流转：共享池 available --申购--> 客户 locked --出库锁定--> pendingOutbound --发货--> shipped\n"
        "出库单状态流转：locked(已锁库存) -> picking(拣货中) -> shipped(已发货) -> delivered(已签收)"
    )
    ax.text(
        0.5,
        legend_y - 0.025,
        summary,
        ha="center",
        va="top",
        fontsize=8.5,
        color="#37474F",
        linespacing=1.5,
        bbox=dict(boxstyle="round,pad=0.5", facecolor="#ECEFF1", edgecolor="#B0BEC5"),
        transform=ax.transAxes,
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(OUTPUT, dpi=180, bbox_inches="tight", facecolor=fig.get_facecolor(), pad_inches=0.3)
    plt.close()
    print(f"Saved: {OUTPUT}")
    print(f"Size: {os.path.getsize(OUTPUT) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
