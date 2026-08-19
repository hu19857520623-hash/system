package com.takealot.pda

import android.app.Application
import com.takealot.pda.data.ErpClient
import com.takealot.pda.data.SessionStore

class PdaApp : Application() {
    lateinit var session: SessionStore
        private set
    lateinit var api: ErpClient
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        api = ErpClient(session)
    }

    companion object {
        lateinit var instance: PdaApp
            private set
    }
}
