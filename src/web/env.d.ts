/// <reference types="vite/client" />

/**
 * `tsc` cannot parse single-file components, so `.vue` imports need a
 * declaration. The props are `any` because there is nothing to check against
 * here — run `bun run build` (Vite compiles the templates for real) to catch
 * template-level mistakes.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<any, any, any>
  export default component
}
