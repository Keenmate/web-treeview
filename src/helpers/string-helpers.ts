export const isEmptyString = (str: string | null | undefined): boolean =>
  !str || (typeof str === 'string' && str.trim() === '');
export const isNotEmptyString = (str: string | null | undefined) => str && str.trim() !== "";

/**
 * DOM id of a node's row: `{treeId}-{path}`. Keyed by the node's PATH — unique per tree by
 * construction — never by `node.id`, which is the consumer's data and may repeat (a pasted /
 * duplicated copy keeps its source id unless `pasteNodeTransformationCallback` changes it).
 * Characters outside `[A-Za-z0-9.-]` (and `_` itself) are written as `_<hex>_`, so the id has
 * no whitespace and two different paths never map to the same id.
 */
export const rowDomId = (treeId: string, path: string): string =>
  `${treeId}-${path.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`)}`;
