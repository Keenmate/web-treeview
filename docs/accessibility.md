# Accessibility — `@keenmate/web-treeview`

## Keyboard navigation

When the tree body has focus (click any node first), keyboard navigation is active:

| Key | Action |
|-----|--------|
| `ArrowDown` / `ArrowUp` | Focus next / previous visible node |
| `ArrowRight` | Expand and focus first child |
| `ArrowLeft` | Focus parent node |
| `Backspace` | Collapse parent and focus it |
| `Enter` / `Space` | Toggle expand / collapse on focused node |
| `Home` / `End` | Focus first / last visible node |
| `PageDown` / `PageUp` | _TODO — controller gap, tracked in e2e skips_ |
| `Shift+ArrowDown / Up / Home / End` | _TODO — extend selection range, controller gap_ |
| `Ctrl+A` | Add every visible node to the selected set |
| `Ctrl/Cmd+C` / `Ctrl/Cmd+X` / `Ctrl/Cmd+V` | Copy / cut / paste |
| `Delete` / `Shift+Delete` | Delete selected node(s) |
| `Escape` | Cancel pending cut, or clear the selection |

The clipboard and delete shortcuts (Ctrl/Cmd+C/X/V, Delete/Shift+Delete, Escape) are built-in and gated by `shouldHandleKeyboardShortcuts` (default `true`) — set it `false` to opt out entirely. The `onTreeKeydown` interceptor (`ctx = { event, focusedNode, selectedNodes, controller }`) runs **first** on every keydown; returning `true` suppresses both the default navigation and the built-in shortcuts. Built-in delete honors `beforeDeleteCallback` and fires the `onDelete` event.

Plain `Tab` moves focus *out of* the tree to the next focusable element on the page; the tree itself is a single tab stop with internal arrow-key navigation, per the WAI-ARIA tree pattern.

## Focus model

The tree maintains three independent state sets — see [usage.md](./usage.md) for the full API:

- `focusedNode` — single node. Driven by clicks (per `clickBehavior`) and arrow keys. Renders the `.wtv__node-content--focused` always-on marker class plus the optional `focusedNodeClass` (if configured).
- `selectedPaths` — multi-select set. Driven by Ctrl / Shift + click and `Ctrl+A`. Renders `.wtv__node-content--selected` plus the optional `selectedNodeClass`.
- `checkedPaths` — checkbox / data-state set. Driven by checkbox clicks when `shouldShowCheckboxes` is on, or mirrored from `selectedPaths` when checkboxes are off.

`silent: true` on `selectNode` / `clearSelection` / `clearChecked` suppresses BOTH the user callback AND the corresponding DOM event — useful when restoring state from a URL parameter so consumers don't see a phantom "user interaction" event on page load.

## ARIA

The component uses semantic markup but does **not** currently apply the full WAI-ARIA `role="tree"` / `role="treeitem"` model. Tracked as a follow-up. For now the keyboard-navigation model matches the pattern even though the role declarations are not in place — screen reader users will hear the visible labels but not the tree-structure announcements.

## Drag-and-drop accessibility

Native HTML5 drag-and-drop is not keyboard-accessible by default. The component does not currently ship a keyboard-driven move alternative. Consumers who need accessible reordering can wire `tree.moveNode(sourcePath, targetPath, position)` to their own keyboard shortcuts.

## Touch

Long-press (300 ms) initiates a drag from a touch device. The touch ghost element follows the finger and uses the same `onNodeDrop` event as desktop drag-and-drop. Moving > 10 px before the long-press timer fires cancels the drag (allows scrolling).

## Tested patterns

The Playwright e2e suite covers the keyboard navigation paths above. Skipped tests are listed at the bottom of each spec file with a one-line reason; the `keyboard-nav.spec.ts` skips track the PageUp/PageDown and Shift+range controller gaps.
