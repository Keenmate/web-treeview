import type { Index, SearchOptions } from 'flexsearch';
import type { LTreeNode, DropPosition } from './ltree-node';

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
export type TreeChange<T> =
	| { operation: 'create'; parentPath: string; data: T; pathSegment?: string }
	| { operation: 'update'; path: string; data: Partial<T> }
	| { operation: 'delete'; path: string };

export interface ApplyChangesResult {
	successful: number;
	failed: Array<{ index: number; operation: string; path: string; error: string }>;
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

/** Result of {@link Ltree.insertBranch}: `count` inserted, every skipped item in `failed` with the reason. */
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

	isSorted: boolean | null | undefined;
	sortCallback?: (items: LTreeNode<T>[]) => LTreeNode<T>[];

	// Filtering properties
	filteredTree: LTreeNode<T>[] | null;
	isFiltered: boolean;

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

	shouldDisplayDebugInformation: boolean | null | undefined;

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

	filterNodes(_searchText: string, _searchOptions?: SearchOptions): void;

	searchNodes(_searchText: string | null | undefined, _searchOptions?: SearchOptions): LTreeNode<T>[];

	createFilteredTree(targetPaths: string[]): void;

	clearFilter(): void;

	expandAll(
		nodePath?: string | string[] | null | undefined,
		options?: { exclusive?: boolean; noEmit?: boolean }
	): void;
	collapseAll(
		nodePath?: string | string[] | null | undefined,
		options?: { noEmit?: boolean }
	): void;

	insert(path: string, data: T, noEmitChanges?: boolean): void;

	getNodeByPath(path: string, _root?: LTreeNode<T> | null | undefined): LTreeNode<T> | null;

	expandNodes(
		path: string | string[],
		options?: { exclusive?: boolean; noEmit?: boolean }
	): Ltree<T>; // Returns self for chaining

	collapseNodes(
		path: string | string[],
		options?: { noEmit?: boolean }
	): Ltree<T>; // Returns self for chaining

	getNodeDisplayValue(node: LTreeNode<T>): string;

	getNodeSearchValue(node: LTreeNode<T>): string;

	_defaultSort(self: Ltree<T>, items: LTreeNode<T>[]): LTreeNode<T>[];

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
	insertBranch(parentPath: string, data: T[]): InsertBranchResult<T>;
	replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T>;
	deleteBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string };

	// State persistence methods
	getExpandedPaths(): string[];
	setExpandedPaths(paths: string[]): void;
	getAllData(): T[];

	// Internal helpers
	_updateDescendantPaths(node: LTreeNode<T>, oldBasePath: string, newBasePath: string): void;
}
