/**
 * First-run state and the site's name/blurb, loaded once by the router guard.
 *
 * The two live in one store because `GET /api/setup/status` returns them
 * together — so the wizard check and the branding fetch are a single request
 * per page load, not one each.
 */
import { reactive } from 'vue'
import { http } from './api'
import type { SetupStatusResponse } from './api'

export const setup = reactive({
  /** navigation is blocked to `/setup` while true */
  needed: false,
  /** the status request has resolved, so the guard stops refetching */
  checked: false,
  siteName: 'buntalk',
  siteDescription: '',
  /** home-page announcement (Markdown); '' hides it */
  siteNotice: '',
  /** footer line; '' hides it */
  siteFooter: '',
})

export async function checkSetup(): Promise<void> {
  try {
    const s = await http.get<SetupStatusResponse>('/setup/status')
    setup.needed = s.needsSetup
    setup.siteName = s.siteName
    setup.siteDescription = s.siteDescription
    setup.siteNotice = s.siteNotice
    setup.siteFooter = s.siteFooter
  } catch {
    // An unreachable API must not lock the UI into a redirect loop.
    setup.needed = false
  } finally {
    setup.checked = true
  }
}
