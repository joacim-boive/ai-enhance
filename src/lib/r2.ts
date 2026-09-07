import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { runtimeEnv, r2Enabled } from "./env";

const PUT_EXPIRES_SEC = 6 * 60 * 60;
const GET_EXPIRES_SEC = 15 * 60;
export const GPU_URL_EXPIRES_SEC = 6 * 60 * 60;
export const R2_PUT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const R2_PART_SIZE = 64 * 1024 * 1024;
export const R2_MAX_PARTS = 160;

export type R2Head = {
  contentLength: number | null;
  etag: string | null;
  contentType: string | null;
};

export type MultipartGrant = {
  uploadId: string;
  partSize: number;
  partUrls: string[];
};

export type OutputUploadGrant = {
  objectKey: string;
  contentType: string;
  putUrl: string;
  expiresAt: number;
  multipart: MultipartGrant;
};

let corsApplied = false;

export { r2Enabled };

function requireR2(): { client: S3Client; bucket: string } {
  if (!r2Enabled()) {
    throw new Error("Cloudflare R2 is not configured.");
  }
  return { client: r2Client(), bucket: runtimeEnv("R2_BUCKET_NAME") as string };
}

function r2Endpoint(): string {
  const account = runtimeEnv("R2_ACCOUNT_ID");
  const jurisdiction = runtimeEnv("R2_JURISDICTION");
  if (!account) {
    throw new Error("R2_ACCOUNT_ID is missing.");
  }
  if (jurisdiction) {
    return `https://${account}.${jurisdiction}.r2.cloudflarestorage.com`;
  }
  return `https://${account}.r2.cloudflarestorage.com`;
}

function r2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint(),
    credentials: {
      accessKeyId: runtimeEnv("R2_ACCESS_KEY_ID") as string,
      secretAccessKey: runtimeEnv("R2_SECRET_ACCESS_KEY") as string,
    },
    forcePathStyle: true,
  });
}

export async function ensureR2Cors(): Promise<void> {
  if (!r2Enabled() || corsApplied) {
    return;
  }
  const { client, bucket } = requireR2();
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedOrigins: ["*"],
            ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  corsApplied = true;
}

export async function presignPutUrl(objectKey: string, contentType: string): Promise<string> {
  const { client, bucket } = requireR2();
  await ensureR2Cors();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    }),
    { expiresIn: PUT_EXPIRES_SEC },
  );
}

export async function presignGetUrl(
  objectKey: string,
  options?: { downloadName?: string; expiresIn?: number },
): Promise<string> {
  const { client, bucket } = requireR2();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentDisposition: options?.downloadName
        ? `attachment; filename="${options.downloadName.replace(/"/g, "")}"`
        : undefined,
    }),
    { expiresIn: options?.expiresIn ?? GET_EXPIRES_SEC },
  );
}

export async function createOutputUploadGrant(input: {
  objectKey: string;
  contentType: string;
}): Promise<OutputUploadGrant> {
  const { client, bucket } = requireR2();
  await ensureR2Cors();
  const putUrl = await presignPutUrl(input.objectKey, input.contentType);
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
    }),
  );
  if (!created.UploadId) {
    throw new Error("Could not start a multipart upload.");
  }
  const partUrls = await Promise.all(
    Array.from({ length: R2_MAX_PARTS }, (_, index) =>
      getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: input.objectKey,
          UploadId: created.UploadId,
          PartNumber: index + 1,
        }),
        { expiresIn: PUT_EXPIRES_SEC },
      ),
    ),
  );
  return {
    objectKey: input.objectKey,
    contentType: input.contentType,
    putUrl,
    expiresAt: Date.now() + PUT_EXPIRES_SEC * 1000,
    multipart: {
      uploadId: created.UploadId,
      partSize: R2_PART_SIZE,
      partUrls,
    },
  };
}

export async function completeMultipartUpload(input: {
  objectKey: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}): Promise<string | null> {
  const { client, bucket } = requireR2();
  const completed: CompletedPart[] = input.parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => ({ ETag: part.etag, PartNumber: part.partNumber }));
  const result = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: { Parts: completed },
    }),
  );
  return result.ETag ?? null;
}

export async function abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
  const { client, bucket } = requireR2();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: objectKey,
      UploadId: uploadId,
    }),
  );
}

export async function headObject(objectKey: string): Promise<R2Head | null> {
  const { client, bucket } = requireR2();
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    return {
      contentLength: result.ContentLength ?? null,
      etag: result.ETag ?? null,
      contentType: result.ContentType ?? null,
    };
  } catch {
    return null;
  }
}

export async function putJsonObject(objectKey: string, value: unknown): Promise<void> {
  const { client, bucket } = requireR2();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: Buffer.from(JSON.stringify(value), "utf8"),
      ContentType: "application/json",
    }),
  );
}

export async function getJsonObject<T>(objectKey: string): Promise<T | null> {
  const { client, bucket } = requireR2();
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    const text = await result.Body?.transformToString();
    if (!text) {
      return null;
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  const { client, bucket } = requireR2();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function uploadFileToR2(input: {
  objectKey: string;
  filePath: string;
  contentType: string;
}): Promise<R2Head> {
  const { client, bucket } = requireR2();
  const info = await stat(input.filePath);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: input.objectKey,
      Body: createReadStream(input.filePath),
      ContentType: input.contentType,
    },
    partSize: R2_PART_SIZE,
    queueSize: 2,
  });
  const result = await upload.done();
  return {
    contentLength: info.size,
    etag: result.ETag ?? null,
    contentType: input.contentType,
  };
}

export async function putBytesToR2(input: {
  objectKey: string;
  data: Buffer;
  contentType: string;
}): Promise<void> {
  const { client, bucket } = requireR2();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      Body: input.data,
      ContentType: input.contentType,
    }),
  );
}
