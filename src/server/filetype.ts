/**
 * Content sniffing — the security check for uploads.
 *
 * The request's `Content-Type` and filename are attacker-controlled. A file
 * that *is* HTML but is *labelled* `image/png`, stored and served back with the
 * client's claimed type, is a stored-XSS hole on this origin. So the type is
 * derived from the bytes here, and both the stored extension and the
 * Content-Type used when serving come from this module — never from the request.
 *
 * SVG is deliberately absent: it is a valid image format that can carry script
 * and external references, and browsers execute it when served as a document.
 *
 * ponytail: six formats, hand-rolled. `file-type` would cover many more at the
 * cost of a dependency sitting directly in the upload path; reach for it only if
 * this allowlist has to grow a lot.
 */

export interface FileKind {
  mime: string
  ext: string
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

/** Returns the real type of `bytes`, or null if it is not on the allowlist. */
export function sniff(bytes: Uint8Array): FileKind | null {
  // PNG: \x89PNG\r\n\x1a\n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' }
  }
  // JPEG: SOI marker
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  // GIF: "GIF8"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: 'image/gif', ext: 'gif' }
  }
  // WebP: RIFF container whose form type is "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  // AVIF: ISO-BMFF box "ftyp" followed by the "avif" brand
  if (
    startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
    startsWith(bytes, [0x61, 0x76, 0x69, 0x66], 8)
  ) {
    return { mime: 'image/avif', ext: 'avif' }
  }
  // PDF: "%PDF"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { mime: 'application/pdf', ext: 'pdf' }
  }
  return null
}
