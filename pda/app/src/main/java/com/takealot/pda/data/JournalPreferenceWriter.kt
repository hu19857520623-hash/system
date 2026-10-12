package com.takealot.pda.data

import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Serial background snapshots; superseded snapshots can be skipped before serialization. */
class JournalPreferenceWriter(private val serialize: (Any) -> String, private val persist: (String, String) -> Boolean) {
    private val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "pda-journal-io").apply { isDaemon = true } }
    private val revisions = ConcurrentHashMap<String, Long>()
    private val writes = mutableMapOf<String, Future<*>>()

    @Synchronized
    fun enqueue(key: String, snapshot: Any) {
        val revision = (revisions[key] ?: 0L) + 1
        revisions[key] = revision
        writes[key] = executor.submit {
            if (revisions[key] == revision && !persist(key, serialize(snapshot))) {
                throw IOException("作业记录保存失败，请检查设备存储空间")
            }
        }
    }

    /** Call on an I/O thread before a mutation request; never fire-and-forget pending work. */
    fun flushBlocking() {
        while (true) {
            val barrier = synchronized(this) { writes.toMap() }
            var failure: Exception? = null
            barrier.values.forEach { future ->
                try { future.get() } catch (e: Exception) { failure = e }
            }
            // A snapshot may have been superseded while waiting; its replacement must commit too.
            val stable = synchronized(this) { writes.size == barrier.size && writes.all { (key, future) -> barrier[key] === future } }
            if (!stable) continue
            if (failure != null) throw IOException("作业记录尚未保存，未发送请求，请重试", failure)
            return
        }
    }

    fun close() { flushBlocking(); executor.shutdown() }
}
