@echo off
set APP_HOME=%~dp0
java -Dfile.encoding=UTF-8 -Xmx64m -Xms64m -classpath "%APP_HOME%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
