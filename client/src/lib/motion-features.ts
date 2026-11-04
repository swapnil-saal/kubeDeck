/**
 * framer-motion's animation engine, loaded after first paint by <LazyMotion> in App.tsx.
 * Components import `m as motion` (a ~5 KB shell) instead of the full `motion` export.
 * `domAnimation` covers animate / exit / hover / tap; switch to `domMax` only if a
 * component needs layout or drag animations.
 */
export { domAnimation as default } from "framer-motion";
