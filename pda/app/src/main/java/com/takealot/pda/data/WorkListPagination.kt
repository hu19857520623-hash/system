package com.takealot.pda.data

internal data class WorkListPage<T>(val items: List<T>, val nextPage: Int, val hasMore: Boolean)

/** Commit all status pages together, so a failed status read can retry the same page. */
internal fun <T, K> mergeWorkListPages(
    previous: List<T>, pages: List<PageResult<T>>, requestedPage: Int,
    key: (T) -> K, accepts: (T) -> Boolean = { true },
): WorkListPage<T> {
    if (requestedPage < 1 || pages.isEmpty() || pages.any {
        it.page != requestedPage || it.pageSize < 1 || it.total < 0 || it.items == null
    }) throw ErpException("作业列表分页信息异常，请刷新列表后重试")
    val rows = linkedMapOf<K, T>()
    previous.forEach { if (accepts(it)) rows[key(it)] = it }
    pages.forEach { page -> page.items.orEmpty().forEach { if (accepts(it)) rows[key(it)] = it } }
    return WorkListPage(rows.values.toList(), requestedPage + 1,
        pages.any { it.page.toLong() * it.pageSize < it.total })
}
