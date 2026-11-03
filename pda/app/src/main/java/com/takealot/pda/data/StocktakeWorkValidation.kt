package com.takealot.pda.data

fun validateStocktakeWork(plan: StocktakePlan, warehouseCode: String) {
    if (warehouseCode.isBlank()) throw ErpException("请先在首页选择作业仓库")
    if (plan.warehouseCode != warehouseCode) throw ErpException("该盘点单不属于当前作业仓库，请返回首页核对仓库")
    if (plan.statusKey != "counting") throw ErpException("当前盘点单不在盘点中，请返回任务列表刷新后继续")
}
