# Java COS 上传工具

该工具对应原 Python 示例：上传本地文件，并生成默认 2 小时有效的临时下载链接。密钥只从环境变量读取，不写进代码。

## 构建

```powershell
cd D:\all\erp\tools\cos-uploader-java
D:\all\erp\services\mvnw.cmd -f pom.xml package
```

## 配置

```powershell
$env:TENCENT_COS_SECRET_ID="新 SecretId"
$env:TENCENT_COS_SECRET_KEY="新 SecretKey"
$env:TENCENT_COS_BUCKET="tkl-bucket-1445997041"
$env:TENCENT_COS_REGION="ap-guangzhou"
```

临时密钥还需要设置 `TENCENT_COS_SESSION_TOKEN`。

## 上传单个文件

```powershell
java -jar target/cos-uploader-1.0.0.jar --prefix=erp/legacy-imports/ "D:\供应商导出.xlsx"
```

## 上传整个目录

```powershell
java -jar target/cos-uploader-1.0.0.jar --prefix=erp/product-images/ "D:\待上传图片"
```

批量迁移时可添加 `--quiet`，不在日志中打印临时签名链接：

```powershell
java -jar target/cos-uploader-1.0.0.jar --quiet --prefix=erp/product-images/ "D:\待上传图片"
```
