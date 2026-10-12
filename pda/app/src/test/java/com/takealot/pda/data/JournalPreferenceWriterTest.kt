package com.takealot.pda.data

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class JournalPreferenceWriterTest {
    @Test fun serializationAndDiskWritesAreOffTheCallerThread() {
        val caller = Thread.currentThread()
        val threads = mutableListOf<Thread>()
        val disk = ConcurrentHashMap<String, String>()
        val writer = JournalPreferenceWriter({ threads += Thread.currentThread(); it.toString() }, { key, value -> disk[key] = value; true })
        writer.enqueue("records", "pending-request-1")
        writer.flushBlocking()
        assertEquals("pending-request-1", disk["records"])
        assertTrue(threads.all { it !== caller })
        writer.close()
    }

    @Test fun latestSnapshotWinsAndAllKeysAreDurableBeforeBarrierReturns() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val disk = ConcurrentHashMap<String, String>()
        val writer = JournalPreferenceWriter({ value ->
            if (value == "block") { entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)) }
            value.toString()
        }, { key, value -> disk[key] = value; true })
        writer.enqueue("blocker", "block")
        assertTrue(entered.await(5, TimeUnit.SECONDS))
        writer.enqueue("records", "old")
        writer.enqueue("records", "new-pending")
        writer.enqueue("progress", "SKU-A=16")
        release.countDown()
        writer.flushBlocking()
        assertEquals("new-pending", disk["records"])
        assertEquals("SKU-A=16", disk["progress"])
        writer.close()
    }

    @Test fun diskFailureBlocksRequestsAndNewSnapshotCanRecover() {
        var allowWrite = false
        val writer = JournalPreferenceWriter({ it.toString() }, { _, _ -> allowWrite })
        writer.enqueue("records", "pending")
        try { writer.flushBlocking(); fail("Failed persistence must block the request") } catch (_: IOException) { }
        allowWrite = true
        writer.enqueue("records", "pending-retry")
        writer.flushBlocking()
        writer.close()
    }
}
