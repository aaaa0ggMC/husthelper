/**
 * SPDX-License-Identifier: LGPL-3.0-or-later
 *
 * Out-of-process entry point for the stdchar CAPTCHA recognizer.
 * Reads a GIF from stdin, writes the recognized string to stdout.
 */

import { decodeGifFrames } from "../src/captcha.ts";
import { recognizeStdChar } from "./index.ts";

const chunks: Buffer[] = [];
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", async () => {
  try {
    const code = await recognizeStdChar(decodeGifFrames(Buffer.concat(chunks)));
    process.stdout.write(code);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
});
