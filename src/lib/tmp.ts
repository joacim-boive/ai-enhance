import os from "node:os";
import path from "node:path";

export function tmpPath(name: string): string {
  return path.join(/* turbopackIgnore: true */ os.tmpdir(), name);
}
