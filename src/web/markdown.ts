/**
 * Markdown rendering for post bodies.
 *
 * This configuration *is* the security boundary: rendered output goes into
 * `v-html`, so the renderer must be structurally unable to emit attacker HTML.
 *
 *   * `html: false` — raw HTML in the source is escaped to text, never parsed.
 *     Every tag in the output is one markdown-it generated itself.
 *   * `validateLink` (markdown-it's default, deliberately not overridden)
 *     rejects `javascript:`, `vbscript:`, `file:` and non-image `data:` URLs, so
 *     `[click](javascript:alert(1))` renders as inert text.
 *
 * Those two together make the output safe without a DOM sanitizer, which would
 * otherwise drag jsdom in to run outside a browser.
 *
 * ponytail: code blocks are not syntax-highlighted; that needs highlight.js plus
 * a theme. Add it when code-heavy threads show up.
 */
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  // Forums are typed by hand: a single newline should be a line break, not a
  // soft wrap that silently joins two lines.
  breaks: true,
})

export function renderMarkdown(source: string): string {
  return md.render(source)
}
