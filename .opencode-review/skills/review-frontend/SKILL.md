---
name: review-frontend
description: Review checklist for frontend UI changes (React, Vue, Svelte, Angular components, .tsx/.jsx/.vue/.svelte, CSS, HTML templates), covering XSS, state, effects, accessibility and rendering performance.
---

# Frontend Review Checklist

## Security
- User-controlled data rendered with `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `{@html}` or `bypassSecurityTrust*`.
- URLs from data placed in `href`/`src` without blocking `javascript:` schemes; `target="_blank"` to external sites without `rel="noopener"` in older browsers.
- Tokens or personal data stored in `localStorage` or logged to the console.

## State and effects
- React `useEffect`/`useMemo`/`useCallback` dependency arrays missing values that the diff shows are used (stale closures) or containing values recreated every render (infinite loops).
- Effects that subscribe, start timers or fetch without cleanup or cancellation (race when inputs change quickly).
- State updated from props without syncing when props change; derived state stored instead of computed.
- Lists rendered with array index keys where items are reordered, inserted or removed.
- Vue: mutating props, reactivity lost by destructuring reactive objects.

## Accessibility
- Interactive elements built from `div`/`span` without role, keyboard handling and focus styles.
- Images without `alt`; form inputs without labels; icon-only buttons without accessible names.
- Focus not managed when opening or closing dialogs.

## Performance
- Expensive computations or large list rendering on every keystroke without memoization or virtualization.
- Large dependencies imported for small utilities; images without size constraints causing layout shift.

## Do not report
- Visual design preferences, or styling the project's design system already defines.
