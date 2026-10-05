/**
 * Upload-path checks. The two things that must not regress:
 *   1. the accepted type comes from the *bytes*, never from the request, so a
 *      file whose content is HTML can never be stored as an image;
 *   2. keys can never escape the upload directory.
 *
 * Config comes from `test/setup.ts` (bunfig preload), so the dynamic imports
 * here are only for parallelism with the other suites.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sniff } from '../src/server/filetype'
import * as storage from '../src/server/storage'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

const text = (value: string) => new TextEncoder().encode(value)

describe('sniff — accepted formats', () => {
  test('identifies PNG, JPEG, GIF and PDF from their headers', () => {
    expect(sniff(PNG)).toEqual({ mime: 'image/png', ext: 'png' })
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    })
    expect(sniff(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))?.ext).toBe('gif')
    expect(sniff(text('%PDF-1.7'))?.mime).toBe('application/pdf')
  })

  test('reads WebP and AVIF from their inner brand, not just the outer header', () => {
    const webp = new Uint8Array(16)
    webp.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    expect(sniff(webp)?.mime).toBe('image/webp')

    const avif = new Uint8Array(16)
    avif.set([0x66, 0x74, 0x79, 0x70], 4) // ftyp
    avif.set([0x61, 0x76, 0x69, 0x66], 8) // avif
    expect(sniff(avif)?.mime).toBe('image/avif')

    // A RIFF container that is not WebP (e.g. WAV) must not slip through.
    const wav = new Uint8Array(16)
    wav.set([0x52, 0x49, 0x46, 0x46], 0)
    wav.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
    expect(sniff(wav)).toBeNull()
  })
})

describe('sniff — rejections', () => {
  // The case this whole module exists for.
  test('rejects HTML, SVG and plain text whatever they are named', () => {
    expect(sniff(text('<!doctype html><script>alert(1)</script>'))).toBeNull()
    expect(sniff(text('<html><body onload=alert(1)>'))).toBeNull()
    expect(sniff(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sniff(text('just some text'))).toBeNull()
  })

  test('rejects empty and truncated buffers without throwing', () => {
    expect(sniff(new Uint8Array(0))).toBeNull()
    expect(sniff(new Uint8Array([0x89]))).toBeNull()
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull()
    expect(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull()
    expect(sniff(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('key validation', () => {
  test('accepts generated keys', () => {
    expect(storage.isValidKey('a1b2c3d4-0000-4000-8000-000000000000.png')).toBe(true)
    expect(storage.isValidKey('x.webp')).toBe(true)
  })

  test('rejects anything that could escape the upload directory', () => {
    const bad = [
      '../secret.png',
      '..',
      'a/b.png',
      '/etc/passwd',
      'nested/dir.png',
      '.hidden',
      '',
      'a b.png',
      'a\\b.png',
    ]
    for (const key of bad) {
      expect(storage.isValidKey(key)).toBe(false)
    }
  })
})

describe('local storage driver', () => {
  test('is the driver selected by the test config', () => {
    expect(storage.driver).toBe('local')
  })

  test('round-trips an object onto disk byte-for-byte', async () => {
    const key = `${crypto.randomUUID()}.png`
    await storage.put(key, PNG, 'image/png')
    const written = new Uint8Array(readFileSync(join(storage.uploadDir, key)))
    expect(written).toEqual(PNG)
  })

  test('publicUrl is null locally — Hono serves the bytes itself', async () => {
    expect(await storage.publicUrl('anything.png')).toBeNull()
  })
})
