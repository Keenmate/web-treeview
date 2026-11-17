/**
 * The tree's floating surfaces — the drop pads (floating `drop-zone-mode`) and the touch drag ghost —
 * are core `createLayer()` layers (SPEC §12.29): mounted in the overlay container outside the tree, so
 * the tree's (or a scroll parent's) `overflow` can't clip them, with their own shadow root holding
 * `layers.css`. The `--wtv-*` tokens that sheet reads are copied from the host (`cssVars`), so an
 * instance override on the host reaches the layer.
 */
import { createLayer, type Layer, type LayerOptions } from '@keenmate/web-components-core/positioning';
import { isRtl } from '@keenmate/web-components-core';
import layerCss from '../css/layers.css?inline';

/** Opens a layer for the tree. `<web-treeview>` supplies one that also adopts its custom CSS into the layer root. */
export type TreeLayerOpener = (host: HTMLElement, options: LayerOptions) => Layer;

/** Every `--wtv-*` token the layer sheet reads (copied from the host onto the layer). */
const LAYER_VARS: readonly string[] = [...new Set(layerCss.match(/--wtv-[\w-]+/g) ?? [])];

/** The element a tree layer belongs to: the shadow host of the tree's container, else the container itself. */
function layerHost(container: HTMLElement): HTMLElement {
  const root = container.getRootNode();
  return root instanceof ShadowRoot ? (root.host as HTMLElement) : container;
}

/**
 * Open a tree layer. Both are `isInteractive: false` (`pointer-events: none` on the layer): the ghost so
 * the touch hit test sees through it; the pads' layer box covers the hovered row, which must keep
 * getting its drag events — the pads themselves opt back in (`.wtv__drop-zone { pointer-events: auto }`).
 * Stacks at the tree's own `zIndexToken`.
 */
export function openTreeLayer(
  container: HTMLElement,
  options: { className: string; zIndexToken: string },
  opener?: TreeLayerOpener | null,
): Layer {
  const host = layerHost(container);
  const layer = (opener ?? createLayer)(host, {
    css: layerCss,
    className: options.className,
    isInteractive: false,
    zIndex: `var(${options.zIndexToken})`,
    cssVars: [...LAYER_VARS, options.zIndexToken],
  });
  // The layer resets inherited styles (`all: initial`) and sits outside the tree: carry the
  // tree's text font and its writing direction (the pads are laid out with logical insets).
  const style = getComputedStyle(container);
  layer.layer.style.fontFamily = style.fontFamily;
  layer.layer.style.lineHeight = style.lineHeight;
  layer.element.dir = isRtl(container) ? 'rtl' : 'ltr';
  return layer;
}
