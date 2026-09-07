export async function putBlobToUrl(
  url: string,
  body: Blob,
  contentType: string,
): Promise<string | null> {
  const response = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
  return response.headers.get("ETag");
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
}): Promise<{ uploadId?: string; parts?: { partNumber: number; etag: string }[] }> {
  const singlePutLimit = 5 * 1024 * 1024 * 1024 - 1024 * 1024;
  if (!input.multipart || input.file.size <= singlePutLimit) {
    await putBlobToUrl(input.putUrl, input.file, input.contentType);
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
    const etag = await putBlobToUrl(url, chunk, "application/octet-stream");
    if (!etag) {
      throw new Error("R2 did not return an ETag for a multipart part.");
    }
    parts.push({ partNumber, etag });
    offset += input.multipart.partSize;
    partNumber += 1;
  }
  return { uploadId: input.multipart.uploadId, parts };
}
