/**
 * The markdown renderer is the security boundary: its output goes into `v-html`
 * with user-authored text. These tests assert the *property* (no tag in the
 * output can execute) rather than markdown-it's exact HTML, so they keep
 * meaning if the renderer is swapped.
 *
 * Note that escaped payloads legitimately appear in the output as text, so the
 * checks are structural — they inspect real tags, never raw substrings.
 */
import { describe, expect, test } from 'bun:test'
import { renderMarkdown } from '../src/web/markdown'

/** Extracts only genuine tags — escaped text is `&lt;img`, which never matches. */
function tags(html: string): string[] {
  return html.match(/<[a-z][^>]*>/gi) ?? []
}

const DANGEROUS_URL = /(?:href|src)\s*=\s*["']?(?:javascript|vbscript|data:(?!image\/))/i
const EVENT_HANDLER = /\son[a-z]+\s*=/i

describe('renderMarkdown — injection payloads', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<svg/onload=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](vbscript:msgbox(1))',
    '[click](data:text/html;base64,PHNjcmlwdD4=)',
    '![x](javascript:alert(1))',
    '# <iframe src="javascript:alert(1)"></iframe>',
    '> <body onload=alert(1)>',
    '```\n</code><script>alert(1)</script>\n```',
    '**[x](javascript:alert(1))**',
  ]

  test('no payload produces an executable tag', () => {
    for (const payload of payloads) {
      const html = renderMarkdown(payload)
      for (const tag of tags(html)) {
        expect(EVENT_HANDLER.test(tag)).toBe(false)
        expect(DANGEROUS_URL.test(tag)).toBe(false)
        expect(tag.toLowerCase().startsWith('<script')).toBe(false)
      }
    }
  })

  test('raw HTML is escaped, not dropped silently', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  // Sharper than the loop above: a valid link *does* emit an anchor (proven in
  // the output suite), so "no anchor here" is a real assertion, not a vacuous one.
  test('a javascript: link produces no anchor at all', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('<a ')
  })

  test('a javascript: image degrades to inert text, not an image tag', () => {
    const html = renderMarkdown('![x](javascript:alert(1))')
    expect(DANGEROUS_URL.test(html)).toBe(false)
    // No <img> at all: markdown-it leaves the source as escaped text, which is
    // why asserting on the substring "javascript:" would be meaningless.
    expect(html).not.toContain('<img')
    // It degrades to the literal source as text — inert, and by design.
    expect(html).toContain('![x](javascript:alert(1))')
  })

  test('an injected tag inside a code fence stays escaped', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('<pre><code>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('renderMarkdown — normal output', () => {
  test('renders the common constructs', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('*em*')).toContain('<em>em</em>')
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>')
    expect(renderMarkdown('> quoted')).toContain('<blockquote>')
    expect(renderMarkdown('`code`')).toContain('<code>code</code>')
    expect(renderMarkdown('---')).toContain('<hr>')
  })

  test('keeps a genuine link intact', () => {
    const html = renderMarkdown('[site](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<a ')
  })

  test('turns a single newline into a line break', () => {
    expect(renderMarkdown('a\nb')).toContain('<br>')
  })

  test('linkifies a bare URL', () => {
    expect(renderMarkdown('see https://example.com now')).toContain('href="https://example.com"')
  })

  test('renders an empty body as an empty string', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
