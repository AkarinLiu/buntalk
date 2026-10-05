/**
 * Not a test file — spawned by `s3.test.ts` with S3 environment variables.
 *
 * `storage.ts` reads its configuration at import time and the test process is
 * pinned to the local driver by the preload, so the s3 branch can only be
 * exercised in a fresh process.
 */
import { publicUrl } from '../src/server/storage'

process.stdout.write(String(await publicUrl(process.argv[2] ?? 'a.png')))
