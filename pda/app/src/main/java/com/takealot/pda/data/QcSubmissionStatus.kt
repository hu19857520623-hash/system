package com.takealot.pda.data

internal fun qcSubmissionStatus(status: String?): String = if (status == null || status == "pending") "pass" else status
