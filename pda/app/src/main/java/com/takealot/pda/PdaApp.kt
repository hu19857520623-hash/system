package com.takealot.pda

import android.app.Application
import com.takealot.pda.data.ErpClient
import com.takealot.pda.data.LanguageStore
import com.takealot.pda.data.PdaWorkJournal
import com.takealot.pda.data.SessionStore

class PdaApp : Application() {
    lateinit var session: SessionStore
        private set
    lateinit var api: ErpClient
        private set
    lateinit var workJournal: PdaWorkJournal
        private set
    lateinit var language: LanguageStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        api = ErpClient(session)
        workJournal = PdaWorkJournal(this)
        language = LanguageStore(this)
    }

    companion object {
        lateinit var instance: PdaApp
            private set
    }
}
