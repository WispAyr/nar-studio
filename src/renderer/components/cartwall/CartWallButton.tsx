/**
 * Re-export of the launcher pill that lives next to the panel. Kept as its
 * own module so the audio strip can `import { CartWallButton } from
 * '../cartwall/CartWallButton'` without pulling the panel implementation
 * into its own bundle slice. Tree-shakers handle both shapes equivalently,
 * but the explicit module is friendlier for downstream callers reading the
 * file tree.
 */
export { CartWallButton } from './CartWallPanel'
