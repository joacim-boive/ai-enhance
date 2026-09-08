// Browser-only upload helper. Uses XHR against presigned URLs so we can show progress.
// Do not import @aws-sdk here — the S3 client stays on the server.

export type UploadByteProgress = {
  loaded: number;
  total: number;
};

export async function putBlobToUrl(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (progress: UploadByteProgress) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag"));
        return;
      }
      reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      reject(
        new Error(
          "Browser could not reach R2. Add a CORS rule on the bucket allowing GET, PUT, and HEAD from *, and expose ETag.",
        ),
      );
    };
    xhr.onabort = () => {
      reject(new Error("Upload was cancelled."));
    };
    xhr.send(body);
  });
}

export type BrowserMultipart = {
  uploadId: string;
  partSize: number;
  partUrls: string[];
};

export async function uploadBrowserFile(input: {
  file: File;
  contentType: string;
  putUrl: string;
  multipart: BrowserMultipart | null;
  onProgress?: (progress: UploadByteProgress) => void;
}): Promise<{ uploadId?: string; parts?: { partNumber: number; etag: string }[] }> {
  const singlePutLimit = 5 * 1024 * 1024 * 1024 - 1024 * 1024;
  if (!input.multipart || input.file.size <= singlePutLimit) {
    await putBlobToUrl(input.putUrl, input.file, input.contentType, input.onProgress);
    return {};
  }
  const parts: { partNumber: number; etag: string }[] = [];
  let offset = 0;
  let partNumber = 1;
  while (offset < input.file.size) {
    const url = input.multipart.partUrls[partNumber - 1];
    if (!url) {
      throw new Error("File is larger than the presigned multipart grant.");
    }
    const chunk = input.file.slice(offset, offset + input.multipart.partSize);
    const etag = await putBlobToUrl(url, chunk, "application/octet-stream", (progress) => {
      input.onProgress?.({
        loaded: offset + progress.loaded,
        total: input.file.size,
      });
    });
    if (!etag) {
      throw new Error("R2 did not return an ETag for a multipart part.");
    }
    parts.push({ partNumber, etag });
    offset += input.multipart.partSize;
    partNumber += 1;
  }
  return { uploadId: input.multipart.uploadId, parts };
}
