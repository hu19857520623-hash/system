package com.tkl.tools;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.auth.BasicSessionCredentials;
import com.qcloud.cos.auth.COSCredentials;
import com.qcloud.cos.http.HttpMethodName;
import com.qcloud.cos.http.HttpProtocol;
import com.qcloud.cos.region.Region;

import java.io.File;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** 上传一个或多个本地文件到腾讯云 COS，并生成临时 GET 下载链接。 */
public final class CosUploader {
    private CosUploader() {}

    public static void main(String[] args) throws Exception {
        String secretId = requiredEnv("TENCENT_COS_SECRET_ID");
        String secretKey = requiredEnv("TENCENT_COS_SECRET_KEY");
        String bucket = requiredEnv("TENCENT_COS_BUCKET");
        String region = requiredEnv("TENCENT_COS_REGION");
        String token = System.getenv("TENCENT_COS_SESSION_TOKEN");

        String prefix = "";
        long expiresSeconds = 7200L;
        boolean quiet = false;
        List<Path> inputs = new ArrayList<>();
        for (String arg : args) {
            if (arg.startsWith("--prefix=")) {
                prefix = normalizePrefix(arg.substring("--prefix=".length()));
            } else if (arg.startsWith("--expires=")) {
                expiresSeconds = Long.parseLong(arg.substring("--expires=".length()));
            } else if (arg.equals("--quiet")) {
                quiet = true;
            } else {
                inputs.add(Paths.get(arg).toAbsolutePath().normalize());
            }
        }
        if (inputs.isEmpty()) {
            throw new IllegalArgumentException("用法：java -jar cos-uploader.jar [--prefix=目录/] [--expires=7200] <文件或目录>...");
        }
        if (expiresSeconds <= 0) throw new IllegalArgumentException("--expires 必须大于 0");

        COSCredentials credentials = token == null || token.isBlank()
                ? new BasicCOSCredentials(secretId, secretKey)
                : new BasicSessionCredentials(secretId, secretKey, token);
        ClientConfig clientConfig = new ClientConfig(new Region(region));
        clientConfig.setHttpProtocol(HttpProtocol.https);
        COSClient client = new COSClient(credentials, clientConfig);

        int uploaded = 0;
        try {
            for (Path input : inputs) {
                if (!Files.exists(input)) throw new IllegalArgumentException("文件不存在：" + input);
                if (Files.isDirectory(input)) {
                    try (var paths = Files.walk(input)) {
                        for (Path file : paths.filter(Files::isRegularFile).sorted().toList()) {
                            String relative = input.relativize(file).toString().replace(File.separatorChar, '/');
                            upload(client, bucket, prefix + relative, file, expiresSeconds, quiet);
                            uploaded++;
                        }
                    }
                } else {
                    upload(client, bucket, prefix + input.getFileName(), input, expiresSeconds, quiet);
                    uploaded++;
                }
            }
        } finally {
            client.shutdown();
        }
        System.out.println("上传完成: " + uploaded + " 个文件");
    }

    private static void upload(COSClient client, String bucket, String key, Path file, long expiresSeconds, boolean quiet) {
        client.putObject(bucket, key, file.toFile());
        client.getObjectMetadata(bucket, key);
        if (quiet) return;
        Date expiresAt = new Date(System.currentTimeMillis() + expiresSeconds * 1000L);
        URL temporaryUrl = client.generatePresignedUrl(bucket, key, expiresAt, HttpMethodName.GET);
        System.out.println("文件名: " + file.getFileName());
        System.out.println("对象键: " + key);
        System.out.println("临时下载链接: " + temporaryUrl);
    }

    private static String normalizePrefix(String value) {
        String normalized = value.trim().replace('\\', '/').replaceAll("^/+", "");
        return normalized.isEmpty() || normalized.endsWith("/") ? normalized : normalized + "/";
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("缺少环境变量：" + name);
        return value.trim();
    }
}
