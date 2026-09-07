import path from "node:path";
import type { StoredFile } from "./storage";

export const SAMPLE_FILE_ID = "sample-24fps";
export const SAMPLE_FILE_NAME = "sample-24fps.mp4";
export const SAMPLE_PUBLIC_PATH = "/sample-24fps.mp4";
export const SAMPLE_SOURCE_PATH = "public/sample-24fps.mp4";

export const SAMPLE_STORED_FILE: StoredFile = {
  id: SAMPLE_FILE_ID,
  name: SAMPLE_FILE_NAME,
  url: SAMPLE_PUBLIC_PATH,
  pathname: SAMPLE_SOURCE_PATH,
};

export function sampleFilePath(): string {
  return path.join(process.cwd(), SAMPLE_SOURCE_PATH);
}
