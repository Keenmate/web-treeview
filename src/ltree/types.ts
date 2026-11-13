import type { Index, SearchOptions } from 'flexsearch';
import type { LTreeNode, DropPosition } from './ltree-node';

/** Options of the expand / collapse family (`expandNodes`, `collapseNodes`,
 *  `toggleNodeExpanded`, `expandAll`, `collapseAll`). */
export interface ExpandOptions {
	/** Expand: collapse every expanded node that is not on the target's ancestor
	 *  chain (or under the target). No effect on collapse. */
	isExclusive?: boolean;
	/** Change the state without announcing it: no `node-expand` / `node-collapse`
	 *  / `expanded-change` (the tree still re-renders). */
	isSilent?: boolean;
}

/** ctx of `SortOptions.compareCallback`: two siblings. */
export interface SortCompareContext<T = any> {
	a: LTreeNode<T>;
	b: LTreeNode<T>;
}

/** Options of `sortNodes` / `sortAll`. */
export interface SortOptions<T = any> {
	/** Ascending comparator (negative = `a` first). Default: the tree's own rule — `sortCallback`
	 *  → `orderMember` → `Intl.Collator(numeric)` by display value. With `orderMember` set, a
	 *  custom compare rewrites the order values (10, 20, 30…) and fires `nodes-reorder`. */
	compareCallback?: (ctx: SortCompareContext<T>) => number;
	/** `'desc'` reverses whichever rule applies (with `orderMember`: the values are rewritten,
	 *  like a custom compare). Default `'asc'`. */
	direction?: 'asc' | 'desc';
	/** Suppress `nodes-reorder` only — the tree always re-renders. */
	isSilent?: boolean;
}

/** One parent whose children's `orderMember` values a sort rewrote. */
export interface NodesReorderContext<T = any> {
	/** The parent ('' = root). */
	parentPath: string;
	/** All its children, in the new order. */
	nodes: LTreeNode<T>[];
	/** Only the children whose order value changed. */
	changes: Array<{ path: string; oldOrder: number | undefined; newOrder: number }>;
}

// Re-export LTreeNode and DropPosition for convenience
export type { LTreeNode, DropPosition } from './ltree-node';

export type Tuple<T, U> = [T, U];
// 'none' = drag disabled; 'self' = same-tree only (reject cross-tree drops);
// 'cross' = cross-tree only (reject same-tree drops); 'both' = either.
// Mirrors svelte-treeview's DragDropMode.
export type DragDropMode = 'none' | 'self' | 'cross' | 'both';
export type DropZoneLayout = 'around' | 'before' | 'after' | 'wave' | 'wave2';
export type DropOperation = 'move' | 'copy';

// Incremental update types
/** One `applyChanges` operation: `add` (last child of `parentPath`), `insert` (before / after /
 *  as a child of `targetPath`), `update` (merge `data` into the node's data), `remove`. */
export type TreeChange<T> =
	| { operation: 'add'; parentPath: string; data: T; pathSegment?: string }
	| { operation: 'insert'; targetPath: string; position: DropPosition; data: T }
	| { operation: 'update'; path: string; data: Partial<T> }
	| { operation: 'remove'; path: string };

export interface ApplyChangesResult {
	successful: number;
	failed: Array<{ changeIndex: number; operation: string; path: string; error: string }>;
}

export interface InsertArrayResult<T> {
	successful: number;
	failed: Array<{
		node: LTreeNode<T>;
		originalData: T;
		error: string;
	}>;
	total: number;
}

/** Result of {@link Ltree.addBranch} / {@link Ltree.insertBranch}: `count` inserted, every skipped item in `failed` with the reason. */
export interface InsertBranchResult<T> {
	success: boolean;
	count: number;
	failed: Array<{ data: T; error: string }>;
	/** The parent the branch went under (the root for ''); null when it wasn't found. */
	parentNode: LTreeNode<T> | null;
	/** Set when the whole call failed (e.g. the parent wasn't found). */
	error?: string;
}

/** Result of {@link Ltree.replaceBranch}: the insert result plus `removed` descendants and `added` (= `count`). */
export interface ReplaceBranchResult<T> extends InsertBranchResult<T> {
	removed: number;
	added: number;
}

/** Result of {@link Ltree.removeBranch}: `count` = nodes removed. */
export interface RemoveBranchResult<T = any> {
	success: boolean;
	count: number;
	/** Set when nothing was removed (e.g. the path wasn't found). */
	error?: string;
}

export interface Ltree<T> {
	// Properties (readonly getters)
	treePathSeparator: string;

	root: LTreeNode<T>;
	filteredRoot: LTreeNode<T>;

	changeTracker: Symbol | undefined;

	idMember: string | null | undefined;
	pathMember: string | null | undefined;
	parentPathMember: string | null | undefined;
	levelMember: string | null | undefined;

	hasChildrenMember: string | null | undefined;
	isExpandedMember: string | null | undefined;
	getIsExpandedCallback?: (node: LTreeNode<T>) => boolean;
	isCheckedMember: string | null | undefined;
	getIsCheckedCallback?: (node: LTreeNode<T>) => boolean;

	displayValueMember?: string | null | undefined;
	getDisplayValueCallback?: (node: LTreeNode<T>) => string;
	/** Text shown for a node with no resolvable display value (neither member nor
	 *  callback yields one). Mutable — set it to re-render the fallback labels.
	 *  Defaults to '[N/A]'; set to '' to render nothing. */
	displayValueFallback: string;

	searchValueMember?: string | null | undefined;
	getSearchValueCallback?: (node: LTreeNode<T>) => string;

	// For sibling ordering in drag-drop (before/after positioning)
	orderMember?: string | null | undefined;

	/** Hint: the input is already in insert order (parents first, siblings ordered) —
	 *  insertArray / addBranch skip sorting the input. addBranch still re-sorts
	 *  each affected parent's children (existing + new). */
	isSorted: boolean | null | undefined;
	/** Orders the children of ONE parent (`items` are siblings). */
	sortCallback?: (items: LTreeNode<T>[]) => LTreeNode<T>[];
	/** `false` = never auto-sort: the input order is kept, addNode appends, insertNode /
	 *  insertBranch / moveNode / copy keep the exact position (with `orderMember` the order
	 *  values are still computed). `sortNodes` / `sortAll` still sort. Default `true`. */
	isSortingEnabled: boolean;

	// Filtering properties
	filteredTree: LTreeNode<T>[] | null;
	isFiltered: boolean;
	/** EXPERIMENTAL — which descendants of a filter match stay visible. See {@link FilterScope}. */
	filterScope?: FilterScope;
	/** EXPERIMENTAL — the `x` used by the depth-limited {@link FilterScope}s (default 1). */
	filterDescendantDepth?: number;
	/** EXPERIMENTAL — expand the descendants a filterScope ADDS (default true). When false they
	 *  start collapsed; matches + their ancestors are always expanded. */
	shouldExpandFilterDescendants?: boolean;
	/** Max matches a search/filter returns (default DEFAULT_SEARCH_RESULT_LIMIT). */
	searchResultLimit?: number;
	/** Fired as the async search index fills (per idle batch) and once on completion. */
	onIndexProgress?: (progress: IndexProgress) => void;
	/** Fired every time filterNodes applies or clears a filter. */
	onSearchStatus?: (status: SearchStatus) => void;

	isSelectableMember: string | null | undefined;
	getIsSelectableCallback?: (node: LTreeNode<T>) => boolean;
	isDraggableMember: string | null | undefined;
	getIsDraggableCallback?: (node: LTreeNode<T>) => boolean;
	isDropAllowedMember: string | null | undefined;
	getIsDropAllowedCallback?: (node: LTreeNode<T>) => boolean;
	allowedDropPositionsMember: string | null | undefined;
	getAllowedDropPositionsCallback?: (node: LTreeNode<T>) => DropPosition[] | null | undefined;
	isCollapsibleMember: string | null | undefined;
	getIsCollapsibleCallback?: (node: LTreeNode<T>) => boolean;

	// onChange callback — replaces Svelte's $state reactivity
	onChange: (() => void) | null;

	// Method to get allowed drop positions (uses callback or member)
	getNodeAllowedDropPositions(node: LTreeNode<T>): DropPosition[] | null | undefined;
	getNodeIsDraggable(node: LTreeNode<T>): boolean;
	getNodeIsCollapsible(node: LTreeNode<T>): boolean;
	getNodeIsDropAllowed(node: LTreeNode<T>): boolean;

	// Methods
	get tree(): LTreeNode<T>[];
	/** Flat array of all visible nodes in render order (depth-first, respects isExpanded) */
	get visibleFlatNodes(): LTreeNode<T>[];
	get statistics(): { nodeCount: number; maxLevel: number; filteredNodeCount: number; isIndexing: boolean; pendingIndexCount: number };

	insertArray(data: T[]): InsertArrayResult<T>;

	insertTreeNode(parentPath: string, newNode: LTreeNode<T>, noEmitChanges?: boolean): string | null;

	filterNodes(_term: string, _searchOptions?: SearchOptions): void;

	searchNodes(_term: string | null | undefined, _searchOptions?: SearchOptions): LTreeNode<T>[];

	createFilteredTree(targetPaths: string[]): void;
	/** @internal */
	_resolveSearchLimit(searchOptions?: SearchOptions): number;
	/** @internal Runs the index query with the result limit + truncation detection. */
	_runSearch(
		searchTerm: string,
		searchOptions?: SearchOptions
	): { nodes: LTreeNode<T>[]; isLimited: boolean; limit: number };
	/** @internal Adds descendants of filter matches per filterScope (EXPERIMENTAL). */
	_addFilterScopeDescendants(targetPaths: string[], required: Set<LTreeNode<T>>): void;

	clearFilter(): void;

	expandAll(
		nodePath?: string | string[] | null | undefined,
		options?: ExpandOptions
	): void;
	collapseAll(
		nodePath?: string | string[] | null | undefined,
		options?: ExpandOptions
	): void;


	getNodeByPath(path: string, _root?: LTreeNode<T> | null | undefined): LTreeNode<T> | null;

	expandNodes(
		path: string | string[],
		options?: ExpandOptions
	): Ltree<T>; // Returns self for chaining

	collapseNodes(
		path: string | string[],
		options?: ExpandOptions
	): Ltree<T>; // Returns self for chaining

	getNodeDisplayValue(node: LTreeNode<T>): string;

	getNodeSearchValue(node: LTreeNode<T>): string;

	/** Where this tree logs (the hosting element's instance loggers; set via opts). */
	log?: import('../logger').TreeLoggers;

	_defaultSort(self: Ltree<T>, items: LTreeNode<T>[]): LTreeNode<T>[];

	_sortSiblings(items: LTreeNode<T>[], options?: Pick<SortOptions<T>, 'compareCallback' | 'direction'>): LTreeNode<T>[];
	/** Stable sort by level only (parents before children, input order kept among siblings). */
	_sortByLevel(items: LTreeNode<T>[]): LTreeNode<T>[];
	/** The automatic re-sort after a mutation: `refreshSiblings` unless `isSortingEnabled` is false. */
	_autoSortSiblings(parentPath: string): void;
	_sortChildrenOf(parent: LTreeNode<T>, options: SortOptions<T> | undefined, out: NodesReorderContext<T>[]): void;
	/** Sort the children of each node (one level; '' = root). Returns the orderMember rewrites. */
	sortNodes(paths: string | string[], options?: SortOptions<T>): NodesReorderContext<T>[];
	/** Sort whole subtrees (`null` / omitted = the whole tree). Returns the orderMember rewrites. */
	sortAll(paths?: string | string[] | null, options?: SortOptions<T>): NodesReorderContext<T>[];

	_emitTreeChanged(): void;

	refresh(): void;

	// Partial refresh methods for tree editor support
	getChildren(parentPath: string): LTreeNode<T>[];
	getSiblings(path: string): LTreeNode<T>[];
	refreshSiblings(parentPath: string): void;
	refreshNode(path: string): void;

	// Tree editor mutation methods
	moveNode(sourcePath: string, targetPath: string, position: DropPosition): { success: boolean; error?: string };
	removeNode(path: string, includeDescendants?: boolean): { success: boolean; node?: LTreeNode<T>; error?: string };
	addNode(parentPath: string, data: T, pathSegment?: string): { success: boolean; node?: LTreeNode<T>; error?: string };
	insertNode(targetPath: string, data: T, position: DropPosition): { success: boolean; node?: LTreeNode<T>; error?: string };
	updateNode(path: string, dataUpdates: Partial<T>): { success: boolean; node?: LTreeNode<T>; error?: string };
	applyChanges(changes: TreeChange<T>[]): ApplyChangesResult;

	// Cross-tree copy method
	copyNodeWithDescendants(
		sourceNode: LTreeNode<T>,
		targetParentPath: string,
		transformData: (data: T, node: LTreeNode<T>) => T | null,
		siblingPath?: string,
		position?: 'before' | 'after'
	): { success: boolean; rootNode?: LTreeNode<T>; count: number; error?: string };

	// Bulk operations
	addBranch(parentPath: string, data: T[]): InsertBranchResult<T>;
	insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T>;
	replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T>;
	removeBranch(path: string, keepParent?: boolean): RemoveBranchResult<T>;

	// State persistence methods
	getExpandedPaths(): string[];
	setExpandedPaths(paths: string[]): void;
	getAllData(): T[];

	// Internal helpers
	_updateDescendantPaths(node: LTreeNode<T>, oldBasePath: string, newBasePath: string): void;
	_placeRelative(parentPath: string, block: LTreeNode<T>[], targetNode: LTreeNode<T>, position: 'before' | 'after'): void;
}

/**
 * EXPERIMENTAL — which descendants of a filter match stay visible (ancestors always do).
 * `x` = `filterDescendantDepth`.
 * - `'matches'` (default) — matches + their ancestors only.
 * - `'descendants'` — every match also shows its whole subtree.
 * - `'tree-depth'` — a match at level >= (max tree depth - x) shows its whole subtree.
 * - `'subtree-height'` — a match whose own subtree is at most x levels deep shows it.
 * - `'levels-below'` — every match shows x levels beneath it.
 */
export type FilterScope = 'matches' | 'descendants' | 'tree-depth' | 'subtree-height' | 'levels-below';

/** Progress of the async search index (see `index-progress`). `processed`/`total` count
 *  nodes queued by the current load; search/filter results are partial until `isComplete`. */
export interface IndexProgress {
	processed: number;
	total: number;
	isComplete: boolean;
}

/** State of the last applied filter (see `search-status-change`). `isLimited` = more nodes
 *  matched than `limit` and the rest were cut off; `isIndexing` = the search index was still
 *  filling, so `matchCount` may grow (the filter re-applies itself when indexing completes,
 *  firing a fresh status). */
export interface SearchStatus {
	searchTerm: string;
	matchCount: number;
	isLimited: boolean;
	limit: number;
	isIndexing: boolean;
}
