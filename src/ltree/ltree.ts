import FlexSearch, { Index, type SearchOptions } from 'flexsearch';

import { type LTreeNode, type DropPosition, createLTreeNode } from './ltree-node';

import { isEmptyString } from '../helpers/string-helpers';
import {
	getLevel,
	getParentPath,
	getPathSegments,
	getRelativePath
} from '../helpers/ltree-helpers';

import type { Ltree, FilterScope, ExpandOptions, SortOptions, NodesReorderContext, Tuple, InsertArrayResult, InsertBranchResult, ReplaceBranchResult, RemoveBranchResult } from './types';
import { createSearchIndex } from './flex';
import { Indexer, DEFAULT_INDEXER_BATCH_SIZE } from './indexer';

/** Default max matches a search/filter returns (FlexSearch's silent default is 100).
 *  Override with `searchResultLimit` or a per-call `{ limit }`. */
export const DEFAULT_SEARCH_RESULT_LIMIT = 1000;
import { perfStart, perfEnd, perfSummary } from '../perf-logger';
import { defaultTreeLoggers } from '../logger';

/** Display-value comparator of the default sibling rule (numeric-aware: "Item 2" < "Item 10"). */
const displayCollator = new Intl.Collator(undefined, { numeric: true });

/** Helper to safely access a property on a generic data item using a string member name */
function getField(item: unknown, member: string): any {
	return (item as Record<string, unknown>)[member];
}

export function createLTree<T>(
	_idMember: string,
	_pathMember: string,
	_parentPathMember?: string | null | undefined,
	_levelMember?: string | null | undefined,
	_hasChildrenMember?: string | null | undefined,
	_isExpandedMember?: string | null | undefined,
	_getIsExpandedCallback?: (node: LTreeNode<T>) => boolean,
	_isSelectableMember?: string | null | undefined,
	_getIsSelectableCallback?: (node: LTreeNode<T>) => boolean,
	_isCheckedMember?: string | null | undefined,
	_getIsCheckedCallback?: (node: LTreeNode<T>) => boolean,
	_isDraggableMember?: string | null | undefined,
	_getIsDraggableCallback?: (node: LTreeNode<T>) => boolean,
	_isDropAllowedMember?: string | null | undefined,
	_getIsDropAllowedCallback?: (node: LTreeNode<T>) => boolean,
	_allowedDropPositionsMember?: string | null | undefined,
	_displayValueMember?: string | null | undefined,
	_getDisplayValueCallback?: (node: LTreeNode<T>) => string,

	_searchValueMember?: string | null | undefined,
	_getSearchValueCallback?: (node: LTreeNode<T>) => string,

	_getAllowedDropPositionsCallback?: (node: LTreeNode<T>) => import('./types').DropPosition[] | null | undefined,

	_isCollapsibleMember?: string | null | undefined,
	_getIsCollapsibleCallback?: (node: LTreeNode<T>) => boolean,

	_orderMember?: string | null | undefined,

	_treeId?: string,
	_treePathSeparator?: string | null | undefined,

	_expandLevel?: number | null | undefined,
	_shouldUseInternalSearchIndex?: boolean | null | undefined,
	_initializeIndexCallback?: () => Index,
	_indexerBatchSize?: number | null | undefined,
	_indexerTimeout?: number | null | undefined,

	opts?: Partial<Ltree<T>>
): Ltree<T> {
	/** The DATA logger (the element's instance logger when hosted). */
	const dataLog = () => (opts?.log ?? defaultTreeLoggers).DATA;
	let shouldCalculateParentPath: boolean = isEmptyString(_parentPathMember);
	let shouldCalculateLevel: boolean = isEmptyString(_levelMember);
	let shouldCalculateHasChildren: boolean = isEmptyString(_hasChildrenMember);
	let shouldCalculateIsExpanded: boolean = isEmptyString(_isExpandedMember);
	let shouldCalculateIsSelectable: boolean = isEmptyString(_isSelectableMember);
	let shouldCalculateIsChecked: boolean = isEmptyString(_isCheckedMember);
	let shouldCalculateIsDraggable: boolean = isEmptyString(_isDraggableMember);
	let shouldCalculateIsDropAllowed: boolean = isEmptyString(_isDropAllowedMember);
	let shouldCalculateAllowedDropPositions: boolean = isEmptyString(_allowedDropPositionsMember);
	let shouldCalculateIsCollapsible: boolean = isEmptyString(_isCollapsibleMember);
	let shouldCalculateDisplayValue: boolean = isEmptyString(_displayValueMember);
	let shouldCalculateSearchValue: boolean = isEmptyString(_searchValueMember);

	// Private state variables
	let root = createLTreeNode<T>();
	let filteredRoot = createLTreeNode<T>();

	// path → node lookup. The hierarchy lives in each node's ordered `children` array; the
	// index is the ONLY way paths are resolved (paths are never walked segment by segment),
	// so a top-level node may carry any path — e.g. a window "1.20.302" cut from a bigger
	// ltree whose ancestors "1" / "1.20" are not loaded.
	const index = new Map<string, LTreeNode<T>>();
	const filteredIndex = new Map<string, LTreeNode<T>>();

	/** Index `node` and its whole subtree. */
	function indexSubtree(node: LTreeNode<T>): void {
		index.set(node.path, node);
		for (const child of node.children) indexSubtree(child);
	}

	/** Drop `node` and its whole subtree from the index; returns the removed paths. */
	function unindexSubtree(node: LTreeNode<T>, out: Set<string> = new Set()): Set<string> {
		index.delete(node.path);
		out.add(node.path);
		for (const child of node.children) unindexSubtree(child, out);
		return out;
	}

	/** Remove `child` from `parent.children` (keeps `hasChildren` in sync). */
	function detachChild(parent: LTreeNode<T>, child: LTreeNode<T>): void {
		const i = parent.children.indexOf(child);
		if (i !== -1) parent.children.splice(i, 1);
		if (parent.children.length === 0) parent.hasChildren = false;
	}

	/** Proper ancestor paths of `path` by ltree prefix ("1.20.302" → "1", "1.20"). */
	function ancestorPrefixes(path: string, sep: string): string[] {
		const out: string[] = [];
		let i = path.indexOf(sep);
		while (i !== -1) {
			out.push(path.substring(0, i));
			i = path.indexOf(sep, i + sep.length);
		}
		return out;
	}
	let searchIndex: Index | null | undefined = null;

	if (_shouldUseInternalSearchIndex)
		searchIndex = _initializeIndexCallback ? _initializeIndexCallback() : createSearchIndex();

	// Replaces Svelte's $state(Symbol()) — plain variable + callback pattern
	let changeTracker = Symbol();
	let onChangeCallback: (() => void) | null = null;

	let size = 0;
	let nodeCount = 0;
	let maxLevel = 0;

	let flatTreeNodes: LTreeNode<T>[] = [];
	// Placeholder for a removed flatTreeNodes slot (positions are the search-index keys,
	// so slots are never spliced out; the slot is also dropped from the index).
	const searchTombstone: LTreeNode<T> = createLTreeNode<T>();

	/** Drop removed nodes from search: tombstone their slots + remove them from the index (and its queue). */
	function dropFromSearch(paths: Set<string>): void {
		if (paths.size === 0) return;
		const removedPositions = new Set<number>();
		flatTreeNodes.forEach((n, i) => {
			if (n !== searchTombstone && paths.has(n.path)) removedPositions.add(i);
		});
		for (const i of removedPositions) flatTreeNodes[i] = searchTombstone;
		indexer?.dropItems(removedPositions);
	}

	/** Resolve search-index hits (slot numbers) to live nodes, skipping tombstones. */
	function nodesAt(rows: unknown[]): LTreeNode<T>[] {
		const out: LTreeNode<T>[] = [];
		for (const row of rows) {
			const n = flatTreeNodes[row as number];
			if (n && n !== searchTombstone) out.push(n);
		}
		return out;
	}
	let filteredTree: LTreeNode<T>[] | null = null;
	let isFiltered = false;

	// Last search text passed to filterNodes. The index fills asynchronously, so a filter
	// applied while it is still warming up (e.g. a tree that STARTS with a searchTerm) sees
	// an incomplete index - the indexer's completion callback re-applies it.
	let _lastFilterSearchText: string | null | undefined = null;
	let _lastFilterSearchOptions: SearchOptions | undefined = undefined;

	// Cache for visibleFlatNodes - only recompute when tree changes
	let cachedVisibleFlatNodes: LTreeNode<T>[] = [];
	let cachedVisibleFlatNodesTracker: Symbol | null = null;

	// Async search indexing infrastructure
	let indexer: Indexer<T> | null = null;

	// Initialize indexer when search index is available
	if (_shouldUseInternalSearchIndex && searchIndex) {
		indexer = new Indexer<T>(
			_treeId || 'unknown',
			searchIndex,
			shouldCalculateSearchValue,
			_searchValueMember,
			_getSearchValueCallback,
			_indexerBatchSize || DEFAULT_INDEXER_BATCH_SIZE, // batch size with fallback
			_indexerTimeout || 50 // timeout with fallback
		);
	}

	/** The real-tree node at `path` ('' = root) — mutations always target the real tree,
	 *  never the filtered copy. */
	function nodeAt(path: string | null | undefined): LTreeNode<T> | undefined {
		return path ? index.get(path) : root;
	}

	/** The node at `path` (or, if absent, its deepest loaded ancestor) with its ancestors,
	 *  top-down — resolved through the parent chain, so window roots work. */
	function chainTo(path: string, idx: Map<string, LTreeNode<T>>, sep: string): LTreeNode<T>[] {
		let node = idx.get(path);
		if (!node) {
			const prefixes = ancestorPrefixes(path, sep);
			for (let i = prefixes.length - 1; i >= 0 && !node; i--) node = idx.get(prefixes[i]);
		}
		const chain: LTreeNode<T>[] = [];
		while (node && chain.length < 10000) {
			chain.push(node);
			node = node.parentPath ? idx.get(node.parentPath) : undefined;
		}
		return chain.reverse();
	}

	/** A top-level node: no parent (null / '' — explicit via parentPathMember, or a
	 *  single-segment path) or one that names itself as its parent. */
	function isTopLevel(node: LTreeNode<T>): boolean {
		return !node.parentPath || node.parentPath === node.path;
	}

	/** parentPath (member or derived from the path) + pathSegment = the path relative to the
	 *  parent; a top-level node's segment is its whole path (a window "1.20.302" stays whole). */
	function setParentAndSegment(node: LTreeNode<T>, row: T, sep: string): void {
		node.parentPath = shouldCalculateParentPath ? getParentPath(node.path, sep) : getField(row, _parentPathMember!);
		if (node.parentPath === node.path) node.parentPath = null;
		node.pathSegment = isTopLevel(node)
			? node.path
			: getPathSegments(getRelativePath(node.path, node.parentPath!, sep), 0, 1, sep);
	}

	/** Levels for a batch (unless levelMember supplies them): top-level = 1, otherwise the
	 *  parent's level + 1 — the parent from the batch or the tree. A node whose parent is
	 *  nowhere (an orphan; it fails to insert) falls back to its path depth for sorting. */
	function resolveLevels(nodes: LTreeNode<T>[]): void {
		if (!shouldCalculateLevel) {
			for (const node of nodes) node.level = getField(node.data, _levelMember!);
			return;
		}
		const byPath = new Map<string, LTreeNode<T>>();
		for (const node of nodes) byPath.set(node.path, node);
		const resolved = new Set<LTreeNode<T>>();
		const levelOf = (node: LTreeNode<T>, guard: number): number => {
			if (resolved.has(node)) return node.level!;
			let level: number;
			if (isTopLevel(node)) level = 1;
			else {
				const batchParent = byPath.get(node.parentPath!);
				const treeParent = batchParent ? null : index.get(node.parentPath!);
				if (batchParent && batchParent !== node && guard < 10000) level = levelOf(batchParent, guard + 1) + 1;
				else if (treeParent) level = (treeParent.level ?? 0) + 1;
				else level = getLevel(node.path, _treePathSeparator || '.');
			}
			node.level = level;
			resolved.add(node);
			return level;
		};
		for (const node of nodes) levelOf(node, 0);
	}

	/** Member / callback driven flags. Data and level must be set first (callbacks read them). */
	function seedFlags(node: LTreeNode<T>, row: T): void {
		// isExpanded: callback > member > expandLevel
		if (_getIsExpandedCallback) node.isExpanded = _getIsExpandedCallback(node);
		else if (!shouldCalculateIsExpanded) node.isExpanded = getField(row, _isExpandedMember!);
		else if (_expandLevel) node.isExpanded = (node.level ?? 0) <= _expandLevel;

		// isSelectable: callback > member (stored on node so renderers can read directly)
		if (_getIsSelectableCallback) node.isSelectable = _getIsSelectableCallback(node);
		else if (!shouldCalculateIsSelectable) node.isSelectable = getField(row, _isSelectableMember!);

		// isChecked: callback > member
		if (_getIsCheckedCallback) node.isChecked = _getIsCheckedCallback(node);
		else if (!shouldCalculateIsChecked) node.isChecked = getField(row, _isCheckedMember!);

		if (_getIsDraggableCallback) node.isDraggable = _getIsDraggableCallback(node);
		else if (!shouldCalculateIsDraggable) node.isDraggable = getField(row, _isDraggableMember!);
		if (!shouldCalculateIsCollapsible) node.isCollapsible = getField(row, _isCollapsibleMember!);
		if (_getIsDropAllowedCallback) node.isDropAllowed = _getIsDropAllowedCallback(node);
		else if (!shouldCalculateIsDropAllowed) node.isDropAllowed = getField(row, _isDropAllowedMember!);
		if (!shouldCalculateAllowedDropPositions) node.allowedDropPositions = getField(row, _allowedDropPositionsMember!);

		if (!shouldCalculateHasChildren) node.hasChildren = getField(row, _hasChildrenMember!);
	}

	return {
		// Properties
		treePathSeparator: _treePathSeparator || '.',
		root,
		filteredRoot,
		get changeTracker() {
			return changeTracker;
		},
		idMember: _idMember,
		pathMember: _pathMember,
		parentPathMember: _parentPathMember,
		levelMember: _levelMember,
		isExpandedMember: _isExpandedMember,
		getIsExpandedCallback: _getIsExpandedCallback,
		isCheckedMember: _isCheckedMember,
		getIsCheckedCallback: _getIsCheckedCallback,
		isSelectableMember: _isSelectableMember,
		getIsSelectableCallback: _getIsSelectableCallback,
		isDraggableMember: _isDraggableMember,
		getIsDraggableCallback: _getIsDraggableCallback,
		isDropAllowedMember: _isDropAllowedMember,
		getIsDropAllowedCallback: _getIsDropAllowedCallback,
		allowedDropPositionsMember: _allowedDropPositionsMember,
		hasChildrenMember: _hasChildrenMember,
		displayValueMember: _displayValueMember,
		getDisplayValueCallback: _getDisplayValueCallback,
		displayValueFallback: opts?.displayValueFallback ?? '[N/A]',

		searchValueMember: _searchValueMember,
		getSearchValueCallback: _getSearchValueCallback,
		getAllowedDropPositionsCallback: _getAllowedDropPositionsCallback,
		isCollapsibleMember: _isCollapsibleMember,
		getIsCollapsibleCallback: _getIsCollapsibleCallback,
		orderMember: _orderMember,
		isSorted: false,
		isSortingEnabled: true,

		// Properties for filtering
		filteredTree,
		isFiltered,

		// onChange callback — replaces Svelte's $state reactivity
		set onChange(cb: (() => void) | null) { onChangeCallback = cb; },
		get onChange() { return onChangeCallback; },

		// Methods (will be bound later)
		get tree(): LTreeNode<T>[] {
			if (this.isFiltered) {
				return [...filteredRoot.children];
			}
			if (!root?.children || !changeTracker) {
				return [];
			}

			return [...root.children];
		},

		/**
		 * Returns a flat array of all visible nodes in render order (depth-first).
		 * A node is visible if all its ancestors are expanded.
		 * This is optimized for flat/centralized rendering without recursion.
		 *
		 * Note: This getter depends on changeTracker to ensure cache invalidation
		 * when nodes are expanded/collapsed or the tree structure changes.
		 * Results are cached to avoid recomputation on repeated access.
		 */
		get visibleFlatNodes(): LTreeNode<T>[] {
			// Explicitly read changeTracker to check cache validity
			const _tracker = changeTracker;

			// Return cached result if changeTracker hasn't changed
			if (_tracker === cachedVisibleFlatNodesTracker && cachedVisibleFlatNodes.length > 0) {
				return cachedVisibleFlatNodes;
			}

			const startRoot = this.isFiltered ? filteredRoot : root;
			if (!startRoot?.children || !_tracker) {
				cachedVisibleFlatNodes = [];
				cachedVisibleFlatNodesTracker = _tracker;
				return cachedVisibleFlatNodes;
			}

			const result: LTreeNode<T>[] = [];
			const self = this;

			function traverse(node: LTreeNode<T>) {
				// Children are stored in display order (sorted on insert / per-parent
				// re-sort) — no render-time sorting.
				for (const child of node.children) {
					result.push(child);
					// Only traverse into children if this node is expanded
					if (child.isExpanded && child.hasChildren) {
						traverse(child);
					}
				}
			}

			traverse(startRoot);

			// Cache the result
			cachedVisibleFlatNodes = result;
			cachedVisibleFlatNodesTracker = _tracker;
			return result;
		},

		get statistics() {
			const filteredNodeCount = isFiltered ? filteredTree?.length || 0 : 0;
			const indexerStatus = indexer?.getStatus() || { isProcessing: false, queueSize: 0 };

			return (
				changeTracker && {
					nodeCount,
					maxLevel,
					filteredNodeCount,
					isIndexing: indexerStatus.isProcessing,
					pendingIndexCount: indexerStatus.queueSize
				}
			);
		},

		insertArray: function (data: T[], noEmitChanges: boolean = false): InsertArrayResult<T> {
			data = data || [];

			// Clear any pending indexing from previous calls
			indexer?.clearQueue();
			flatTreeNodes = [];

			// Clear existing tree data - reset root children + the path index
			root.children = [];
			index.clear();
			// Drop the filtered view's copies of the PREVIOUS data; an active filter is
			// re-applied against the new data (engine re-filter + indexer completion).
			filteredRoot.children = [];
			filteredIndex.clear();
			nodeCount = 0;
			maxLevel = 0;

			perfStart(`[${_treeId}] insertArray:conversion`);

			const conversionFailures: Array<{ node: LTreeNode<T>; originalData: T; error: string }> = [];

			let mappedData = data.map((row, index) => {
				const node = createLTreeNode<T>();
				node.treeId = _treeId || '';
				node.id = _idMember ? getField(row, _idMember) : undefined;
				const rawPath = _pathMember ? getField(row, _pathMember) : undefined;

				// Validate path - must be a non-empty string
				if (rawPath == null || rawPath === '' || typeof rawPath !== 'string') {
					node.path = '';
					node.data = row;
					const pathDesc = rawPath === '' ? 'empty string'
						: rawPath == null ? 'undefined/null'
						: `non-string (${typeof rawPath})`;
					conversionFailures.push({
						node,
						originalData: row,
						error: `Item at index ${index} has invalid path (${pathDesc}). Check that pathMember="${_pathMember}" matches your data. First item keys: ${index === 0 ? JSON.stringify(Object.keys(row as any)) : '(see index 0)'}`
					});
					return null;
				}
				node.path = rawPath;
				setParentAndSegment(node, row, this.treePathSeparator);
				node.data = row;
				return node;
			}).filter((node): node is LTreeNode<T> => node !== null);

			// Levels first (they need the whole batch — a window's levels count from its top node),
			// then the per-node flags, whose callbacks / expandLevel read the level.
			resolveLevels(mappedData);
			for (const node of mappedData) seedFlags(node, node.data as T);
			const conversionTime = perfEnd(`[${_treeId}] insertArray:conversion`, data.length);

			perfStart(`[${_treeId}] insertArray:sort`);
			// isSorted = the caller's hint that the data is already in insert order
			// (parents first, siblings ordered) — skip sorting entirely.
			if (!this.isSorted) {
				mappedData = this.isSortingEnabled ? this._defaultSort(this, mappedData) : this._sortByLevel(mappedData);
			}

			const sortTime = perfEnd(`[${_treeId}] insertArray:sort`, data.length);

			perfStart(`[${_treeId}] insertArray:insert`);

			const failedNodes: Array<{ node: LTreeNode<T>; originalData: T; error: string }> = [...conversionFailures];

			// Warn early about data mapping issues (most common user error)
			if (conversionFailures.length > 0) {
				dataLog().warn(
					`${conversionFailures.length} of ${data.length} items have invalid paths (pathMember="${_pathMember}"). These items will be skipped.\n` +
					`First failure: ${conversionFailures[0].error}`
				);
			}
			const itemsToIndex: { node: LTreeNode<T>; index: number }[] = [];

			let realIndex: number = 0; // this is used to avoid scenario, when node cannot found a parent
			let successfulCount: number = 0;
			let hasRenderedExpandLevel = false;

			// Pre-compute the last index at expandLevel to avoid O(n²) lookup
			let lastExpandLevelIndex = -1;
			if (_expandLevel && !noEmitChanges) {
				for (let i = mappedData.length - 1; i >= 0; i--) {
					const nodeLevel = mappedData[i].level || getLevel(mappedData[i].path, this.treePathSeparator);
					if (nodeLevel <= _expandLevel) {
						lastExpandLevelIndex = i;
						break;
					}
				}
			}

			mappedData.forEach((node, index) => {
				const result = this.insertTreeNode(node.parentPath ?? '', node, true);
				if (result) {
					failedNodes.push({
						node: node,
						originalData: node.data as T, // mappedData may be re-ordered vs data
						error: result
					});
				} else {
					successfulCount++;
					// Collect items for batch indexing
					if (_shouldUseInternalSearchIndex && indexer) {
						flatTreeNodes.push(node);
						itemsToIndex.push({ node, index: realIndex });
						realIndex++;
					}

					// Progressive rendering: emit changes when we complete expandLevel
					if (!noEmitChanges && !hasRenderedExpandLevel && _expandLevel && index === lastExpandLevelIndex) {
						// We've processed all nodes up to expandLevel - render now!
						hasRenderedExpandLevel = true;
						this._emitTreeChanged();
					}
				}
			});

			// Log errors for backward compatibility and debugging
			if (failedNodes.length > 0) {
				const errorMessages = failedNodes.map((f) => f.error);
				dataLog().warn(
					`${failedNodes.length} nodes failed to insert:`,
					errorMessages
				);
			}

			// Batch add items to indexer
			if (itemsToIndex.length > 0 && indexer) {
				indexer.setCallbacks(
					(processed, total) => this.onIndexProgress?.({ processed, total, isComplete: false }),
					() => {
						// A filter applied while indexing was in flight saw an incomplete index -
						// re-apply it now (this also emits the tree change + a fresh search status).
						if (!isEmptyString(_lastFilterSearchText)) {
							this.filterNodes(_lastFilterSearchText as string, _lastFilterSearchOptions);
						}
						const { total } = indexer!.getStatus();
						this.onIndexProgress?.({ processed: total, total, isComplete: true });
					}
				);
				indexer.addToQueue(itemsToIndex);
			}

			// Final render (only if we haven't already rendered progressively)
			if (!noEmitChanges) {
				this._emitTreeChanged();
			}

			const insertTime = perfEnd(`[${_treeId}] insertArray:insert`, data.length);

			// Log performance summary
			perfSummary(_treeId || 'unknown', {
				'Conversion': conversionTime,
				'Sort': sortTime,
				'Insert': insertTime
			}, data.length);

			return {
				successful: successfulCount,
				failed: failedNodes,
				total: data.length
			};
		},

		insertTreeNode: function (
			parentPath: string,
			newNode: LTreeNode<T>,
			noEmitChanges?: boolean
		): string | null {
			// Always the real tree (never the filtered copy) — data goes into the tree.
			const parentNode = parentPath ? index.get(parentPath) : root;

			if (!parentNode) {
				return `Node: ${newNode.path} - Could not find parent node: ${parentPath}`;
			}
			if (shouldCalculateLevel) {
				newNode.level = (parentNode.level || 0) + 1;
			}

			// A path clash keeps the existing node (first one wins).
			if (!index.has(newNode.path)) {
				parentNode.children.push(newNode);
				index.set(newNode.path, newNode);
				if (shouldCalculateHasChildren && !parentNode.hasChildren) {
					parentNode.hasChildren = true;
				}

				// Update statistics
				nodeCount++;
				maxLevel = Math.max(maxLevel, newNode.level || 0);
			}

			if (!noEmitChanges) {
				this._emitTreeChanged();
			}

			return null;
		},

		filterNodes(_searchText: string | null | undefined, _searchOptions?: SearchOptions): void {
			_lastFilterSearchText = _searchText;
			_lastFilterSearchOptions = _searchOptions;

			if (isEmptyString(_searchText)) {
				// Clear filter when search is empty
				filteredRoot.children = [];
				filteredIndex.clear();
				this.isFiltered = false;
				this._emitTreeChanged();
				this.onSearchStatus?.({
					searchTerm: '',
					matchCount: 0,
					isLimited: false,
					limit: this._resolveSearchLimit(_searchOptions),
					isIndexing: indexer?.isBusy() ?? false
				});
				return;
			}

			if (!_shouldUseInternalSearchIndex) {
				return;
			}

			perfStart(`[${_treeId}] filterNodes:search`);
			const { nodes, isLimited, limit } = this._runSearch(_searchText!, _searchOptions);
			const foundPaths = nodes.map((n) => n.path);
			perfEnd(`[${_treeId}] filterNodes:search`, nodes.length);

			this.createFilteredTree(foundPaths);
			this.onSearchStatus?.({
				searchTerm: _searchText!,
				matchCount: nodes.length,
				isLimited,
				limit,
				isIndexing: indexer?.isBusy() ?? false
			});
		},

		_resolveSearchLimit(_searchOptions?: SearchOptions): number {
			const explicit = (_searchOptions as { limit?: number } | undefined)?.limit;
			return explicit ?? this.searchResultLimit ?? DEFAULT_SEARCH_RESULT_LIMIT;
		},

		_runSearch(
			_searchText: string,
			_searchOptions?: SearchOptions
		): { nodes: LTreeNode<T>[]; isLimited: boolean; limit: number } {
			// Ask for ONE more than the limit so we can tell "exactly N" from "N+, cut off".
			// (FlexSearch's own default limit is 100 and silent - this replaces it.)
			const limit = this._resolveSearchLimit(_searchOptions);
			const resultIndices = searchIndex!.search(_searchText, {
				...(_searchOptions as object),
				limit: limit + 1
			} as SearchOptions);
			const isLimited = resultIndices.length > limit;
			const nodes = nodesAt(isLimited ? resultIndices.slice(0, limit) : resultIndices);
			return { nodes, isLimited, limit };
		},

		searchNodes(_searchText: string | null | undefined, _searchOptions?: SearchOptions): LTreeNode<T>[] {
			if (isEmptyString(_searchText)) {
				return [];
			}

			if (!_shouldUseInternalSearchIndex) {
				return [];
			}

			return this._runSearch(_searchText!, _searchOptions).nodes;
		},

		createFilteredTree(targetPaths: string[]): void {
			perfStart(`[${_treeId}] createFilteredTree`);
			filteredRoot.children = [];
			filteredIndex.clear();
			filteredTree = null;

			// 1. The hits plus every ancestor (via the parent chain, not the path string)
			const required = new Set<LTreeNode<T>>();
			for (const path of targetPaths) {
				let node = index.get(path);
				while (node && !required.has(node)) {
					required.add(node);
					node = node.parentPath ? index.get(node.parentPath) : undefined;
				}
			}

			// 1b. EXPERIMENTAL filterScope - pull in (some of) each match's descendants.
			// Matches + ancestors are the "context" rows and always expand; the added
			// descendants expand only when shouldExpandFilterDescendants (default true).
			const contextNodes = new Set(required);
			this._addFilterScopeDescendants(targetPaths, required);
			const expandAdded = this.shouldExpandFilterDescendants ?? true;

			// 2. Copy the required nodes in tree order (children reset)
			const copyInto = (source: LTreeNode<T>, target: LTreeNode<T>) => {
				for (const child of source.children) {
					if (!required.has(child)) continue;
					const copiedNode: LTreeNode<T> = {
						...child,
						children: [],
						hasChildren: false,
						isExpanded: expandAdded || contextNodes.has(child)
					};
					target.children.push(copiedNode);
					target.hasChildren = true;
					filteredIndex.set(copiedNode.path, copiedNode);
					copyInto(child, copiedNode);
				}
			};
			copyInto(root, filteredRoot);
			filteredRoot.hasChildren = false;

			const rootNodes = [...filteredRoot.children];
			filteredTree = rootNodes;
			this.isFiltered = true;
			this._emitTreeChanged();

			perfEnd(`[${_treeId}] createFilteredTree`, rootNodes.length);

		},

		_addFilterScopeDescendants(targetPaths: string[], required: Set<LTreeNode<T>>): void {
			const scope: FilterScope = this.filterScope ?? 'matches';
			if (scope === 'matches') return;
			const x = Math.max(0, this.filterDescendantDepth ?? 1);

			const heights = new Map<LTreeNode<T>, number>();
			const heightOf = (n: LTreeNode<T>): number => {
				let h = heights.get(n);
				if (h !== undefined) return h;
				h = 0;
				for (const child of n.children) h = Math.max(h, heightOf(child) + 1);
				heights.set(n, h);
				return h;
			};
			const addSubtree = (n: LTreeNode<T>, levelsLeft: number) => {
				if (levelsLeft <= 0) return;
				for (const child of n.children) {
					required.add(child);
					addSubtree(child, levelsLeft - 1);
				}
			};
			// Root sits at level 0, so its height = the deepest node's level.
			const treeDepth = scope === 'tree-depth' ? heightOf(root) : 0;

			for (const path of targetPaths) {
				const node = index.get(path);
				if (!node) continue;
				if (scope === 'descendants') addSubtree(node, Infinity);
				else if (scope === 'levels-below') addSubtree(node, x);
				else if (scope === 'subtree-height') {
					if (heightOf(node) <= x) addSubtree(node, Infinity);
				} else if (scope === 'tree-depth') {
					if ((node.level ?? 0) >= treeDepth - x) addSubtree(node, Infinity);
				}
			}
		},

		clearFilter(): void {
			filteredRoot.children = [];
			filteredIndex.clear();
			filteredTree = null;
			this.isFiltered = false;
			this._emitTreeChanged();
		},

		expandAll(
			nodePath?: string | string[] | null | undefined,
			options?: ExpandOptions
		): void {
			perfStart(`[${_treeId}] expandAll`);
			const self = this;
			const exclusive = options?.isExclusive ?? false;
			function setExpandedRecursive(node: LTreeNode<T>, value: boolean) {
				if (node.isExpanded !== value) {
					node.isExpanded = value;
					node._rev = (node._rev || 0) + 1;
				}
				for (const child of node.children) setExpandedRecursive(child, value);
			}

			const paths: string[] = Array.isArray(nodePath)
				? nodePath.filter((p): p is string => !isEmptyString(p))
				: isEmptyString(nodePath)
					? []
					: [nodePath!];

			if (paths.length === 0) {
				// Whole-tree expand. exclusive has no meaning (nothing to exclude from).
				setExpandedRecursive(root, true);
			} else {
				if (exclusive) {
					// Spine = union of every ancestor path of every target.
					const spineSet = new Set<string>();
					for (const p of paths) {
						for (const n of chainTo(p, index, this.treePathSeparator)) spineSet.add(n.path);
					}
					const isUnderTarget = (p: string) => {
						for (const tp of paths) {
							if (p === tp || p.startsWith(tp + this.treePathSeparator)) return true;
						}
						return false;
					};
					// Walk currently-expanded subtree; collapse off-spine / off-target.
					const trim = (node: LTreeNode<T>) => {
						for (const child of node.children) {
							if (!child.isExpanded) continue;
							if (spineSet.has(child.path) || isUnderTarget(child.path)) {
								trim(child);
							} else if (self.getNodeIsCollapsible(child)) {
								child.isExpanded = false;
								child._rev = (child._rev || 0) + 1;
								trim(child);
							}
						}
					};
					trim(root);
				}

				// Expand the spine + the entire subtree under each target.
				for (const p of paths) {
					for (const node of chainTo(p, index, this.treePathSeparator)) {
						if (!node.isExpanded) {
							node.isExpanded = true;
							node._rev = (node._rev || 0) + 1;
						}
					}
					const target = index.get(p);
					if (target) setExpandedRecursive(target, true);
				}
			}

			// isSilent = no events only; the tree always re-renders.
			this._emitTreeChanged();
			perfEnd(`[${_treeId}] expandAll`);
		},

		collapseAll(
			nodePath?: string | string[] | null | undefined,
			options?: ExpandOptions
		): void {
			perfStart(`[${_treeId}] collapseAll`);
			const self = this;

			function collapseRecursive(node: LTreeNode<T>) {
				if (node.isExpanded && self.getNodeIsCollapsible(node)) {
					node.isExpanded = false;
					node._rev = (node._rev || 0) + 1;
				}
				for (const child of node.children) collapseRecursive(child);
			}

			const paths: string[] = Array.isArray(nodePath)
				? nodePath.filter((p): p is string => !isEmptyString(p))
				: isEmptyString(nodePath)
					? []
					: [nodePath!];

			if (paths.length === 0) {
				collapseRecursive(root);
			} else {
				for (const p of paths) {
					const target = this.getNodeByPath(p);
					if (target) collapseRecursive(target);
				}
			}

			this._emitTreeChanged(); // isSilent = no events only; always re-render
			perfEnd(`[${_treeId}] collapseAll`);
		},

		expandNodes: function (
			path: string | string[],
			options?: ExpandOptions
		) {
			perfStart(`[${_treeId}] expandNodes`);
			const self = this;
			const exclusive = options?.isExclusive ?? false;
			const rootNode = this.isFiltered ? filteredRoot : root;
			const idx = this.isFiltered ? filteredIndex : index;
			const paths = Array.isArray(path) ? path : [path];
			let hasChanges = false;

			if (exclusive) {
				// Spine = union of every ancestor path of every input target.
				// Walk the currently-expanded subtree and collapse anything
				// off-spine. Bump _rev on each mutation so renderers that key
				// off it (the flat keyed list, the toggle icon class) refresh.
				const spineSet = new Set<string>();
				for (const p of paths) {
					for (const n of chainTo(p, idx, this.treePathSeparator)) spineSet.add(n.path);
				}
				const trim = (node: LTreeNode<T>) => {
					for (const child of node.children) {
						if (!child.isExpanded) continue;
						if (spineSet.has(child.path)) {
							trim(child);
						} else if (self.getNodeIsCollapsible(child)) {
							child.isExpanded = false;
							child._rev = (child._rev || 0) + 1;
							hasChanges = true;
							trim(child);
						}
					}
				};
				trim(rootNode);
			}

			// The target and its ancestors (the deepest loaded one, if the target is absent)
			for (const p of paths) {
				for (const node of chainTo(p, idx, this.treePathSeparator)) {
					if (!node.isExpanded) {
						node.isExpanded = true;
						node._rev = (node._rev || 0) + 1;
						hasChanges = true;
					}
				}
			}

			if (hasChanges) {
				this._emitTreeChanged();
			}

			perfEnd(`[${_treeId}] expandNodes`);
			return this; // Return the API object for chaining
		},

		collapseNodes: function (
			path: string | string[],
			options?: ExpandOptions
		) {
			const idx = this.isFiltered ? filteredIndex : index;
			const paths = Array.isArray(path) ? path : [path];
			let hasChanges = false;

			for (const p of paths) {
				const node = idx.get(p);
				if (node && node.isExpanded) {
					node.isExpanded = false;
					// Bump _rev to match expandNodes — the DOM renderer reads
					// data-expanded directly so it doesn't strictly need this,
					// but custom renderers may key off _rev (parity with
					// svelte-treeview, which does require the bump).
					node._rev = (node._rev || 0) + 1;
					hasChanges = true;
				}
			}

			if (hasChanges) {
				this._emitTreeChanged();
			}

			return this; // Return the API object for chaining
		},

		// Private helper methods
		getNodeByPath: function (
			path: string,
			_root?: LTreeNode<T> | null | undefined
		): LTreeNode<T> | null {
			const useFiltered = _root ? _root === filteredRoot : this.isFiltered;
			if (!path) return useFiltered ? filteredRoot : root;
			return (useFiltered ? filteredIndex : index).get(path) ?? null;
		},

		getNodeDisplayValue(node: LTreeNode<T>): string {
			// Resolution order: member → callback → fallback. A configured member
			// that is absent on this node (getField → undefined/null) must FALL
			// THROUGH to the callback/fallback, not return undefined — otherwise the
			// `.localeCompare` sort tiebreak crashes and `displayValueFallback` never
			// shows (the member defaults to 'displayValue', so any data lacking that
			// field hit this).
			if (!shouldCalculateDisplayValue && node.data) {
				const value = getField(node.data, _displayValueMember!);
				if (value != null) return value;
			}

			if (this.getDisplayValueCallback) return this.getDisplayValueCallback(node);

			return this.displayValueFallback ?? '[N/A]';
		},

		getNodeSearchValue(node: LTreeNode<T>): string {
			// Same member → callback → fallback guard as getNodeDisplayValue; a
			// missing search member must not return undefined into the indexer.
			if (!shouldCalculateSearchValue && node.data) {
				const value = getField(node.data, _searchValueMember!);
				if (value != null) return value;
			}

			if (this.getSearchValueCallback) return this.getSearchValueCallback(node);

			return '[N/A]';
		},

		getNodeAllowedDropPositions(node: LTreeNode<T>): import('./types').DropPosition[] | null | undefined {
			// Priority: callback > member > node property
			if (this.getAllowedDropPositionsCallback) {
				return this.getAllowedDropPositionsCallback(node);
			}

			if (!shouldCalculateAllowedDropPositions && node.data) {
				return getField(node.data, _allowedDropPositionsMember!);
			}

			return node.allowedDropPositions;
		},

		getNodeIsDraggable(node: LTreeNode<T>): boolean {
			if (this.getIsDraggableCallback) return this.getIsDraggableCallback(node);
			if (!shouldCalculateIsDraggable && node.data) return getField(node.data, _isDraggableMember!);
			return node.isDraggable;
		},

		getNodeIsCollapsible(node: LTreeNode<T>): boolean {
			if (this.getIsCollapsibleCallback) return this.getIsCollapsibleCallback(node);
			if (!shouldCalculateIsCollapsible && node.data) return getField(node.data, _isCollapsibleMember!);
			return node.isCollapsible;
		},

		getNodeIsDropAllowed(node: LTreeNode<T>): boolean {
			if (this.getIsDropAllowedCallback) return this.getIsDropAllowedCallback(node);
			if (!shouldCalculateIsDropAllowed && node.data) return getField(node.data, _isDropAllowedMember!);
			return node.isDropAllowed;
		},

		refresh(): void {
			this._emitTreeChanged();
		},

		/**
		 * Get direct children of a node at the given path
		 * @param parentPath - Path to parent node (empty string for root)
		 * @returns Array of child nodes
		 */
		getChildren(parentPath: string): LTreeNode<T>[] {
			// Read changeTracker to check cache validity
			const _tracker = changeTracker;
			const parent = this.getNodeByPath(parentPath);
			if (!parent || !_tracker) return [];
			return parent.children;
		},

		/**
		 * Get siblings of a node (including the node itself)
		 * @param path - Path to the node
		 * @returns Array of sibling nodes (nodes with same parent)
		 */
		getSiblings(path: string): LTreeNode<T>[] {
			// Read changeTracker to check cache validity
			const _tracker = changeTracker;
			const node = this.getNodeByPath(path);
			if (!node || !_tracker) return [];

			// Get parent and return all its children
			const parentPath = node.parentPath || '';
			return this.getChildren(parentPath);
		},

		/**
		 * Re-sort siblings under a parent path using sortCallback or default sort
		 * This reorders the children object to reflect updated order values
		 * @param parentPath - Path to parent node (empty string for root)
		 */
		refreshSiblings(parentPath: string): void {
			const parent = nodeAt(parentPath);
			if (!parent || parent.children.length === 0) return;

			parent.children = this._sortSiblings(parent.children);

			this._emitTreeChanged();
		},

		/**
		 * Refresh a single node and optionally its descendants
		 * Useful after modifying node data externally
		 * @param path - Path to the node to refresh
		 */
		refreshNode(path: string): void {
			// For now, just trigger a tree change
			// Future optimization: only re-render the specific subtree
			this._emitTreeChanged();
		},

		/**
		 * Move a node to a new location in the tree
		 * @param sourcePath - Path of the node to move
		 * @param targetPath - Path of the target node
		 * @param position - Where to place relative to target: 'before', 'after', or 'child'
		 * @returns Object with success status and optional error message
		 */
		moveNode(sourcePath: string, targetPath: string, position: DropPosition): { success: boolean; error?: string } {
			const sep = this.treePathSeparator;
			const sourceNode = index.get(sourcePath);
			if (!sourceNode) {
				return { success: false, error: `Source node not found: ${sourcePath}` };
			}

			const targetNode = index.get(targetPath);
			if (!targetNode) {
				return { success: false, error: `Target node not found: ${targetPath}` };
			}

			// Prevent moving a node into itself or its descendants
			if (targetPath.startsWith(sourcePath + sep) || targetPath === sourcePath) {
				return { success: false, error: 'Cannot move a node into itself or its descendants' };
			}

			const sourceParentPath = sourceNode.parentPath || '';
			const sourceParent = nodeAt(sourceParentPath);
			if (!sourceParent) {
				return { success: false, error: `Source parent not found: ${sourceParentPath}` };
			}

			const newParentPath = position === 'child' ? targetPath : targetNode.parentPath || '';
			const newParent = position === 'child' ? targetNode : nodeAt(newParentPath);
			if (!newParent) {
				return { success: false, error: `Target parent not found: ${newParentPath}` };
			}

			detachChild(sourceParent, sourceNode);

			// Segment: kept at the top level (a window root keeps its whole path); under a
			// parent it is the last segment of the node's path.
			let newSegment = newParent === root
				? sourceNode.pathSegment
				: sourceNode.path.substring(sourceNode.path.lastIndexOf(sep) + sep.length);
			const join = (segment: string) => (newParentPath ? `${newParentPath}${sep}${segment}` : segment);
			const isTaken = (candidate: string) => {
				const existing = index.get(join(candidate));
				return !!existing && existing !== sourceNode;
			};
			if (isTaken(newSegment)) {
				// Segment collision - try the source's ID, then fall back to a timestamp
				const sourceId = sourceNode.id?.toString();
				newSegment = sourceId && !isTaken(sourceId) ? sourceId : `${newSegment}_${Date.now()}`;
			}

			const newPath = join(newSegment);
			const oldPath = sourceNode.path;

			unindexSubtree(sourceNode);
			sourceNode.path = newPath;
			sourceNode.pathSegment = newSegment;
			sourceNode.parentPath = newParentPath || null;
			sourceNode.level = (newParent.level || 0) + 1;
			if (this.pathMember && sourceNode.data) {
				(sourceNode.data as any)[this.pathMember] = newPath;
			}
			this._updateDescendantPaths(sourceNode, oldPath, newPath);
			indexSubtree(sourceNode);

			newParent.hasChildren = true;
			newParent.children.push(sourceNode);
			if (position === 'child') this._autoSortSiblings(newParentPath);
			else this._placeRelative(newParentPath, [sourceNode], targetNode, position);

			return { success: true };
		},

		/**
		 * Position `block` (already children of `parentPath`, in this order) right before / after
		 * `targetNode` among its siblings. With `orderMember` (and data on every block node) the
		 * block gets order values spread between the target and its neighbour, then the siblings
		 * re-sort; otherwise the children object is rebuilt with the block placed directly.
		 */
		_placeRelative(parentPath: string, block: LTreeNode<T>[], targetNode: LTreeNode<T>, position: 'before' | 'after'): void {
			const parent = nodeAt(parentPath);
			if (!parent || block.length === 0) return;
			const inBlock = new Set(block);
			const om = this.orderMember;
			if (om && block.every((n) => n.data)) {
				const targetOrder = (targetNode.data ? getField(targetNode.data, om) : 0) ?? 0;
				const others = (parent.children as LTreeNode<T>[])
					.filter((s) => !inBlock.has(s) && s.data && getField(s.data, om) !== undefined)
					.map((s) => getField(s.data!, om) as number);
				const gap = 20 * block.length;
				let lo: number, hi: number;
				if (position === 'before') {
					hi = targetOrder;
					lo = others.filter((o) => o < targetOrder).sort((a, b) => b - a)[0] ?? targetOrder - gap;
				} else {
					lo = targetOrder;
					hi = others.filter((o) => o > targetOrder).sort((a, b) => a - b)[0] ?? targetOrder + gap;
				}
				const n = block.length;
				const isIntegral = hi - lo >= n + 1;
				block.forEach((node, k) => {
					const v = lo + ((hi - lo) * (k + 1)) / (n + 1);
					(node.data as any)[om] = isIntegral ? Math.floor(v) : v;
				});
				if (this.isSortingEnabled) {
					this.refreshSiblings(parentPath);
					return;
				}
				// isSortingEnabled false: the values are set (persistence); place directly below.
			}
			const newChildren: LTreeNode<T>[] = [];
			let isPlaced = false;
			for (const child of parent.children) {
				if (inBlock.has(child)) continue;
				if (child === targetNode && position === 'before') { newChildren.push(...block); isPlaced = true; }
				newChildren.push(child);
				if (child === targetNode && position === 'after') { newChildren.push(...block); isPlaced = true; }
			}
			if (!isPlaced) newChildren.push(...block);
			parent.children = newChildren;
			this._emitTreeChanged();
		},

		/**
		 * Insert one node next to `targetPath` (`'before'` / `'after'`, as its sibling) or as its
		 * last child (`'child'`, same as {@link addNode} under it). Positioning is moveNode's.
		 */
		insertNode(targetPath: string, data: T, position: DropPosition): { success: boolean; node?: LTreeNode<T>; error?: string } {
			const targetNode = index.get(targetPath);
			if (!targetNode) return { success: false, error: `Target node not found: ${targetPath}` };
			if (position === 'child') return this.addNode(targetPath, data);
			const parentPath = targetNode.parentPath || '';
			const result = this.addNode(parentPath, data);
			if (result.success && result.node) this._placeRelative(parentPath, [result.node], targetNode, position);
			return result;
		},

		/**
		 * Helper to recursively update descendant paths after a move
		 */
		_updateDescendantPaths(node: LTreeNode<T>, oldBasePath: string, newBasePath: string): void {
			for (const child of node.children) {
				// Save the old path BEFORE updating, for correct recursive calculation
				const oldChildPath = child.path;

				// Calculate new path by replacing the old base with new base
				const relativePath = oldChildPath.substring(oldBasePath.length);
				const newChildPath = newBasePath + relativePath;

				child.path = newChildPath;
				child.parentPath = node.path;
				child.level = (node.level || 0) + 1;

				// Update the data object's path if pathMember is defined
				if (this.pathMember && child.data) {
					(child.data as any)[this.pathMember] = newChildPath;
				}

				// Recurse into children using the OLD child path as base
				this._updateDescendantPaths(child, oldChildPath, newChildPath);
			}
		},

		/**
		 * Remove a node from the tree
		 * @param path - Path of the node to remove
		 * @param includeDescendants - If true, removes all descendants (default: true)
		 * @returns Object with success status and the removed node
		 */
		removeNode(path: string, includeDescendants: boolean = true): { success: boolean; node?: LTreeNode<T>; error?: string } {
			const node = index.get(path);
			if (!node) {
				return { success: false, error: `Node not found: ${path}` };
			}

			const parentPath = node.parentPath || '';
			const parent = nodeAt(parentPath);
			if (!parent) {
				return { success: false, error: `Parent not found: ${parentPath}` };
			}

			// The subtree goes with it: out of the path index and the search index (else it stays findable)
			const removedPaths = unindexSubtree(node);
			dropFromSearch(removedPaths);
			detachChild(parent, node);

			nodeCount -= includeDescendants ? removedPaths.size : 1;

			this._emitTreeChanged();
			return { success: true, node };
		},

		/**
		 * Add a new node to the tree
		 * @param parentPath - Path of the parent (empty string for root)
		 * @param data - The data object for the new node
		 * @param pathSegment - Optional path segment (auto-generated if not provided)
		 * @returns Object with success status and the created node
		 */
		addNode(parentPath: string, data: T, pathSegment?: string): { success: boolean; node?: LTreeNode<T>; error?: string } {
			const parent = nodeAt(parentPath);
			if (!parent) {
				return { success: false, error: `Parent not found: ${parentPath}` };
			}

			// Generate path segment if not provided
			if (!pathSegment) {
				// Use ID from data if available, otherwise generate a unique one
				const id = _idMember && data ? (data as any)[_idMember] : undefined;
				pathSegment = id?.toString() || `new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			}

			// At this point pathSegment is guaranteed to be a string
			const segment: string = pathSegment!;

			// Calculate full path
			const newPath: string = parentPath ? `${parentPath}${this.treePathSeparator}${segment}` : segment;

			// Check if path already exists
			if (index.has(newPath)) {
				return { success: false, error: `Node already exists at path: ${newPath}` };
			}

			// Create the node
			const newNode = createLTreeNode<T>();
			newNode.treeId = _treeId || '';
			newNode.id = _idMember && data ? (data as any)[_idMember] : undefined;
			newNode.path = newPath;
			newNode.pathSegment = segment;
			newNode.parentPath = parentPath || null;
			newNode.level = (parent.level || 0) + 1;
			newNode.data = data;

			// Apply seed precedence (callback > member > default) to match insertArray
			if (_getIsExpandedCallback) newNode.isExpanded = _getIsExpandedCallback(newNode);
			else if (!shouldCalculateIsExpanded && data) newNode.isExpanded = getField(data, _isExpandedMember!);
			else newNode.isExpanded = _expandLevel ? newNode.level! <= _expandLevel : false;

			if (_getIsSelectableCallback) newNode.isSelectable = _getIsSelectableCallback(newNode);
			else if (!shouldCalculateIsSelectable && data) newNode.isSelectable = getField(data, _isSelectableMember!);

			if (_getIsCheckedCallback) newNode.isChecked = _getIsCheckedCallback(newNode);
			else if (!shouldCalculateIsChecked && data) newNode.isChecked = getField(data, _isCheckedMember!);

			if (_getIsDraggableCallback) newNode.isDraggable = _getIsDraggableCallback(newNode);
			else if (!shouldCalculateIsDraggable && data) newNode.isDraggable = getField(data, _isDraggableMember!);

			if (_getIsDropAllowedCallback) newNode.isDropAllowed = _getIsDropAllowedCallback(newNode);
			else if (!shouldCalculateIsDropAllowed && data) newNode.isDropAllowed = getField(data, _isDropAllowedMember!);

			// Parity with insertArray (and svelte-treeview): seed the remaining
			// member-driven flags so a copied / added node keeps its drop-position
			// restriction and collapsible flag instead of silently reverting.
			if (!shouldCalculateIsCollapsible && data) newNode.isCollapsible = getField(data, _isCollapsibleMember!);
			if (!shouldCalculateAllowedDropPositions && data) newNode.allowedDropPositions = getField(data, _allowedDropPositionsMember!);

			newNode.hasChildren = false;

			// Update path in data if pathMember is defined
			if (_pathMember && data) {
				(data as any)[_pathMember] = newPath;
			}

			// Add to parent
			parent.children.push(newNode);
			parent.hasChildren = true;
			index.set(newPath, newNode);

			// Update statistics
			nodeCount++;
			maxLevel = Math.max(maxLevel, newNode.level || 0);

			// Add to flat tree for search indexing (slot number = index id) and index it
			flatTreeNodes.push(newNode);
			if (indexer && _shouldUseInternalSearchIndex) {
				indexer.addItem({ node: newNode, index: flatTreeNodes.length - 1 });
			}

			// Re-sort siblings to place new node in correct position (appended when sorting is off)
			this._autoSortSiblings(parentPath);

			this._emitTreeChanged();
			return { success: true, node: newNode };
		},

		/**
		 * Update an existing node's data
		 * @param path - Path of the node to update
		 * @param dataUpdates - Partial data to merge into existing node data
		 * @returns Object with success status and the updated node
		 */
		updateNode(path: string, dataUpdates: Partial<T>): { success: boolean; node?: LTreeNode<T>; error?: string } {
			const node = index.get(path);
			if (!node) {
				return { success: false, error: `Node not found: ${path}` };
			}
			if (!node.data) {
				return { success: false, error: `Node has no data: ${path}` };
			}

			// Check if orderMember is being updated (will need re-sort)
			const orderMemberUpdated = this.orderMember && this.orderMember in dataUpdates;

			// Merge updates into existing data
			node.data = { ...node.data, ...dataUpdates };
			node._rev = (node._rev || 0) + 1;

			// Re-index for search if needed
			if (indexer && _shouldUseInternalSearchIndex) {
				const flatIndex = flatTreeNodes.indexOf(node);
				if (flatIndex !== -1) {
					indexer.addItem({ node, index: flatIndex });
				}
			}

			// Re-sort siblings if order was updated
			if (orderMemberUpdated) {
				this._autoSortSiblings(node.parentPath || '');
			}

			this._emitTreeChanged();
			return { success: true, node };
		},

		/**
		 * Apply multiple changes to the tree in a single batch
		 * @param changes - Array of add / insert / update / remove operations
		 * @returns Object with count of successful operations and array of failures
		 */
		applyChanges(changes: import('./types').TreeChange<T>[]): import('./types').ApplyChangesResult {
			const failures: Array<{ changeIndex: number; operation: string; path: string; error: string }> = [];
			let successCount = 0;

			for (let i = 0; i < changes.length; i++) {
				const change = changes[i];
				let result: { success: boolean; error?: string };

				switch (change.operation) {
					case 'add':
						result = this.addNode(change.parentPath, change.data, change.pathSegment);
						if (result.success) {
							successCount++;
						} else {
							failures.push({
								changeIndex: i,
								operation: change.operation,
								path: change.parentPath,
								error: result.error || 'Unknown error'
							});
						}
						break;
					case 'update':
						result = this.updateNode(change.path, change.data);
						if (result.success) {
							successCount++;
						} else {
							failures.push({
								changeIndex: i,
								operation: change.operation,
								path: change.path,
								error: result.error || 'Unknown error'
							});
						}
						break;
					case 'insert':
						result = this.insertNode(change.targetPath, change.data, change.position);
						if (result.success) {
							successCount++;
						} else {
							failures.push({
								changeIndex: i,
								operation: change.operation,
								path: change.targetPath,
								error: result.error || 'Unknown error'
							});
						}
						break;
					case 'remove':
						result = this.removeNode(change.path);
						if (result.success) {
							successCount++;
						} else {
							failures.push({
								changeIndex: i,
								operation: change.operation,
								path: change.path,
								error: result.error || 'Unknown error'
							});
						}
						break;
				}
			}

			// Single emission after all changes
			if (successCount > 0) {
				this._emitTreeChanged();
			}

			return { successful: successCount, failed: failures };
		},

		/**
		 * Copy a node and all its descendants to a new location
		 * Useful for cross-tree drag-drop operations
		 * @param sourceNode - The node to copy (including its children)
		 * @param targetParentPath - Path where to insert the copy (empty string for root)
		 * @param transformData - Function to transform each node's data (e.g., assign new IDs)
		 * @param siblingPath - Optional path of sibling to position relative to
		 * @param position - Optional position relative to sibling ('before' or 'after')
		 * @returns Object with success status, the created root node, and count of nodes created
		 */
		copyNodeWithDescendants(
			sourceNode: LTreeNode<T>,
			targetParentPath: string,
			transformData: (data: T, node: LTreeNode<T>) => T | null,
			siblingPath?: string,
			position?: 'before' | 'after'
		): { success: boolean; rootNode?: LTreeNode<T>; count: number; error?: string } {
			if (!sourceNode.data) {
				return { success: false, count: 0, error: 'Source node has no data' };
			}

			let totalCount = 0;

			// Recursive helper function
			const copyRecursive = (node: LTreeNode<T>, parentPath: string): LTreeNode<T> | null => {
				if (!node.data) return null;

				// Transform the data (user assigns new IDs, etc.). The live source node
				// is the 2nd arg so batch callers (duplicateNodes) can gate on a manifest.
				// Returning null/undefined SKIPS this node AND its subtree (a "hole").
				const transformedData = transformData(node.data, node);
				if (transformedData == null) return null;

				// Add the node
				const result = this.addNode(parentPath, transformedData);
				if (!result.success || !result.node) {
					dataLog().debug(`copyNodeWithDescendants: Failed to add node`, result.error);
					return null;
				}

				totalCount++;
				const newNode = result.node;

				// Recursively copy children
				for (const child of node.children) copyRecursive(child, newNode.path);

				return newNode;
			};

			// Start the recursive copy
			const rootNode = copyRecursive(sourceNode, targetParentPath);

			if (!rootNode) {
				return { success: false, count: 0, error: 'Failed to copy root node' };
			}

			// Handle positioning relative to sibling if specified
			if (siblingPath && position && rootNode.data) {
				const siblingNode = index.get(siblingPath);
				if (siblingNode) {
					const parent = nodeAt(targetParentPath);
					if (parent) {
						if (this.orderMember) {
							// orderMember mode: calculate order value, then let refreshSiblings sort
							const siblings = parent.children;
							const oKey = this.orderMember!;
							const siblingOrder = (siblingNode.data as any)?.[oKey] ?? 0;

							if (position === 'before') {
								const siblingOrders = siblings
									.filter(s => s !== rootNode && (s.data as any)?.[oKey] !== undefined)
									.map(s => (s.data as any)[oKey] as number)
									.filter(o => o < siblingOrder)
									.sort((a, b) => b - a);
								const prevOrder = siblingOrders[0] ?? siblingOrder - 20;
								(rootNode.data as any)[oKey] = Math.floor((prevOrder + siblingOrder) / 2);
							} else {
								const siblingOrders = siblings
									.filter(s => s !== rootNode && (s.data as any)?.[oKey] !== undefined)
									.map(s => (s.data as any)[oKey] as number)
									.filter(o => o > siblingOrder)
									.sort((a, b) => a - b);
								const nextOrder = siblingOrders[0] ?? siblingOrder + 20;
								(rootNode.data as any)[oKey] = Math.floor((siblingOrder + nextOrder) / 2);
							}
						}
						if (this.orderMember && this.isSortingEnabled) {
							this.refreshSiblings(targetParentPath);
						} else {
							// No orderMember: position it directly next to the sibling
							this._placeRelative(targetParentPath, [rootNode], siblingNode, position);
						}
					}
				}
			}

			return { success: true, rootNode, count: totalCount };
		},

		/**
		 * Insert a batch of nodes under `parentPath` (svelte-treeview parity). Every
		 * item is placed by its OWN path (`pathMember`), so a whole subtree can be
		 * inserted at once; the batch is sorted parents-before-children (skipped
		 * under the `isSorted` hint — the caller guarantees the batch's order), each
		 * affected parent's children are re-sorted (always — the hint covers the
		 * input only, not the existing siblings it merges into), and the tree
		 * emits ONE change. An item is reported in `failed` (and skipped) when its
		 * path is missing / empty / not a string, is not under `parentPath`, already
		 * exists, or its parent can't be found.
		 * @param parentPath - Path of the parent node ('' = root)
		 * @param data - Data rows to insert (each with its full path)
		 */
		addBranch(parentPath: string, data: T[]): InsertBranchResult<T> {
			const parentNode = nodeAt(parentPath);
			if (!parentNode) {
				return { success: false, count: 0, failed: [], parentNode: null, error: 'Parent not found: ' + parentPath };
			}

			data = data || [];
			if (data.length === 0) {
				return { success: true, count: 0, failed: [], parentNode };
			}

			const failed: Array<{ data: T; error: string }> = [];
			const sep = this.treePathSeparator;

			// Convert raw data → LTreeNode (same mapping as insertArray)
			let mappedData = data
				.map((row, index) => {
					const node = createLTreeNode<T>();
					node.treeId = _treeId || '';
					node.id = _idMember ? getField(row, _idMember) : undefined;
					const rawPath = _pathMember ? getField(row, _pathMember) : undefined;

					if (rawPath == null || rawPath === '' || typeof rawPath !== 'string') {
						const pathDesc = rawPath === '' ? 'empty string'
							: rawPath == null ? 'undefined/null'
							: `non-string (${typeof rawPath})`;
						failed.push({ data: row, error: `Item at index ${index} has invalid path (${pathDesc})` });
						return null;
					}
					// web-treeview: the item must live under the target parent.
					if (parentPath && !rawPath.startsWith(parentPath + sep)) {
						failed.push({ data: row, error: `Item at index ${index} (path "${rawPath}") is not under ${parentPath}` });
						return null;
					}
					node.path = rawPath;
					setParentAndSegment(node, row, sep);
					node.data = row;
					return node;
				})
				.filter((node): node is LTreeNode<T> => node !== null);

			resolveLevels(mappedData);
			for (const node of mappedData) seedFlags(node, node.data as T);

			// Parents before children, siblings ordered — unless the caller's
			// isSorted hint says the data is already in that order.
			if (!this.isSorted) {
				mappedData = this.isSortingEnabled ? this._defaultSort(this, mappedData) : this._sortByLevel(mappedData);
			}

			// Insert all nodes silently (no emission per node)
			const affectedParents = new Set<string>();
			let insertedCount = 0;

			for (const node of mappedData) {
				// insertTreeNode silently keeps the existing node on a path clash — report it.
				if (index.has(node.path)) {
					failed.push({ data: node.data!, error: `Node: ${node.path} - a node with this path already exists` });
					continue;
				}
				const result = this.insertTreeNode(node.parentPath ?? '', node, true);
				if (result) {
					failed.push({ data: node.data!, error: result });
				} else {
					insertedCount++;
					affectedParents.add(node.parentPath ?? '');
					if (_shouldUseInternalSearchIndex) flatTreeNodes.push(node);
				}
			}

			// Re-sort each affected parent's children (without emitting — refreshSiblings
			// emits). Also under isSorted: the hint describes the input batch only, not
			// the existing tree the batch is merged into (svelte-treeview parity).
			// isSortingEnabled false: the batch is appended in input order.
			for (const pp of this.isSortingEnabled ? affectedParents : []) {
				const parent = nodeAt(pp);
				if (parent && parent.children.length > 0) parent.children = this._sortSiblings(parent.children);
			}

			// Update hasChildren (+ the hasChildren member) on every parent that received children
			for (const pp of affectedParents) {
				const parent = nodeAt(pp);
				if (!parent) continue;
				parent.hasChildren = parent.children.length > 0;
				if (_hasChildrenMember && parent.data) {
					(parent.data as any)[_hasChildrenMember] = parent.hasChildren;
				}
			}

			// Bump _rev on all affected parents AND their ancestors up to root
			const bumpedPaths = new Set<string>();
			for (const pp of affectedParents) {
				let ancestor = pp ? index.get(pp) : undefined;
				while (ancestor && !bumpedPaths.has(ancestor.path)) {
					bumpedPaths.add(ancestor.path);
					ancestor._rev = (ancestor._rev || 0) + 1;
					ancestor = ancestor.parentPath ? index.get(ancestor.parentPath) : undefined;
				}
			}

			// Batch add to indexer
			if (_shouldUseInternalSearchIndex && indexer) {
				const startIdx = flatTreeNodes.length - insertedCount;
				const itemsToIndex: { node: LTreeNode<T>; index: number }[] = [];
				for (let i = startIdx; i < flatTreeNodes.length; i++) {
					itemsToIndex.push({ node: flatTreeNodes[i], index: i });
				}
				if (itemsToIndex.length > 0) indexer.addToQueue(itemsToIndex);
			}

			// One summary warning (like insertArray) — the details are in `failed`.
			if (failed.length > 0) {
				dataLog().warn(
					`addBranch("${parentPath}"): ${failed.length} of ${data.length} items failed to insert:`,
					failed.map((f) => f.error)
				);
			}

			// Single emission
			this._emitTreeChanged();

			return { success: true, count: insertedCount, failed, parentNode };
		},

		/**
		 * Insert a branch next to `targetPath`: `'before'` / `'after'` = as its siblings (the
		 * items' paths must be under the target's parent), `'child'` = under the target (same as
		 * {@link addBranch}). The block's top-level nodes keep their order from `data`; with
		 * `orderMember` they get order values spread between the target and its neighbour.
		 */
		insertBranch(targetPath: string, data: T[], position: DropPosition): InsertBranchResult<T> {
			const targetNode = index.get(targetPath);
			if (!targetNode) {
				return { success: false, count: 0, failed: [], parentNode: null, error: 'Target not found: ' + targetPath };
			}
			if (position === 'child') return this.addBranch(targetPath, data);
			const parentPath = targetNode.parentPath || '';
			const parent = nodeAt(parentPath);
			const before = new Set(parent?.children ?? []);
			const result = this.addBranch(parentPath, data);
			if (!result.success || !parent) return result;
			const rank = new Map<unknown, number>();
			data.forEach((d, i) => { if (!rank.has(d)) rank.set(d, i); });
			const block = parent.children
				.filter((n) => !before.has(n))
				.sort((a, b) => (rank.get(a.data) ?? 0) - (rank.get(b.data) ?? 0));
			this._placeRelative(parentPath, block, targetNode, position);
			return result;
		},

		/**
		 * Replace all descendants of `parentPath` with `data` (same placement and
		 * validation rules as {@link insertBranch}); one emission.
		 * @returns the insertBranch result plus `removed` (descendants removed) and `added` (= count)
		 */
		replaceBranch(parentPath: string, data: T[]): ReplaceBranchResult<T> {
			const parentNode = nodeAt(parentPath);
			if (!parentNode) {
				return { success: false, count: 0, failed: [], parentNode: null, removed: 0, added: 0, error: 'Parent not found: ' + parentPath };
			}

			// Every descendant leaves the path index (+ search index; also the removed count)
			const pathsToRemove = new Set<string>();
			for (const child of parentNode.children) unindexSubtree(child, pathsToRemove);
			const removedCount = pathsToRemove.size;
			// The search index is keyed by flatTreeNodes POSITION — filtering the array
			// would shift every later position and map hits to the wrong nodes. Tombstone
			// the removed slots instead and drop them from the index (+ its pending queue).
			dropFromSearch(pathsToRemove);

			// Clear children
			parentNode.children = [];
			parentNode.hasChildren = false;
			if (_hasChildrenMember && parentNode.data) {
				(parentNode.data as any)[_hasChildrenMember] = false;
			}
			parentNode._rev = (parentNode._rev || 0) + 1;
			nodeCount -= removedCount;

			// Delegate to addBranch for the new data (it emits unless there is nothing to insert)
			const result = this.addBranch(parentPath, data);
			if (!data || data.length === 0) this._emitTreeChanged();
			return { ...result, removed: removedCount, added: result.count };
		},

		/**
		 * Delete a branch (node and/or its descendants)
		 * @param path - Path of the node
		 * @param keepParent - If true, only remove children, keep the parent node
		 * @returns Object with success status and count of removed nodes
		 */
		removeBranch(path: string, keepParent?: boolean): RemoveBranchResult<T> {
			const node = index.get(path);
			if (!node) {
				return { success: false, count: 0, error: 'Node not found: ' + path };
			}

			let removedCount = 0;

			if (keepParent) {
				// Remove only children
				const children = this.getChildren(path);
				for (let i = children.length - 1; i >= 0; i--) {
					const result = this.removeNode(children[i].path, true);
					if (result.success) {
						removedCount++;
					}
				}
			} else {
				// Count descendants before removing
				const countDescendants = (n: LTreeNode<T>): number => {
					let count = 1;
					for (const child of n.children) {
						count += countDescendants(child);
					}
					return count;
				};
				removedCount = countDescendants(node);
				this.removeNode(path, true);
			}

			this._emitTreeChanged();
			return { success: true, count: removedCount };
		},

		/**
		 * Get paths of all expanded nodes
		 * Useful for saving expanded state before a full redraw
		 * @returns Array of paths that are currently expanded
		 */
		getExpandedPaths(): string[] {
			const paths: string[] = [];
			const traverse = (node: LTreeNode<T>) => {
				if (node.isExpanded && node.path) {
					paths.push(node.path);
				}
				for (const child of node.children) {
					traverse(child);
				}
			};
			traverse(root);
			return paths;
		},

		/**
		 * Set expanded state for given paths
		 * Useful for restoring expanded state after a full redraw
		 * @param paths - Array of paths to expand (all others will be collapsed)
		 */
		setExpandedPaths(paths: string[]): void {
			const pathSet = new Set(paths);
			const traverse = (node: LTreeNode<T>) => {
				if (node.path) {
					node.isExpanded = pathSet.has(node.path);
				}
				for (const child of node.children) {
					traverse(child);
				}
			};
			traverse(root);
			this._emitTreeChanged();
		},

		/**
		 * Extract all node data as a flat array
		 * Useful for saving the entire tree state to a database
		 * @returns Array of all node data objects
		 */
		getAllData(): T[] {
			const result: T[] = [];
			const traverse = (node: LTreeNode<T>) => {
				if (node.data) {
					result.push(node.data);
				}
				for (const child of node.children) {
					traverse(child);
				}
			};
			traverse(root);
			return result;
		},

		/**
		 * The sibling rule — one for the automatic re-sorts and `sortNodes` / `sortAll`:
		 * `compareCallback` (explicit sorts only) → `sortCallback` → `orderMember` (display value
		 * breaks ties) → `Intl.Collator(numeric)` by display value. `direction: 'desc'`
		 * reverses whichever rule applied. Returns a new array.
		 */
		_sortSiblings(
			items: LTreeNode<T>[],
			options?: Pick<SortOptions<T>, 'compareCallback' | 'direction'>
		): LTreeNode<T>[] {
			const byDisplay = (a: LTreeNode<T>, b: LTreeNode<T>) =>
				displayCollator.compare(this.getNodeDisplayValue(a), this.getNodeDisplayValue(b));
			const om = this.orderMember;
			let sorted: LTreeNode<T>[];
			if (items.length < 2) {
				sorted = [...items];
			} else if (options?.compareCallback) {
				const cb = options.compareCallback;
				sorted = [...items].sort((a, b) => cb({ a, b }));
			} else if (this.sortCallback) {
				sorted = [...this.sortCallback([...items])];
			} else if (om) {
				sorted = [...items].sort((a, b) => {
					if (a.data && b.data) {
						const aOrder = getField(a.data, om) ?? 0;
						const bOrder = getField(b.data, om) ?? 0;
						if (aOrder !== bOrder) return aOrder - bOrder;
					}
					return byDisplay(a, b);
				});
			} else {
				sorted = [...items].sort(byDisplay);
			}
			if (options?.direction === 'desc') sorted.reverse();
			return sorted;
		},

		_sortByLevel(items: LTreeNode<T>[]): LTreeNode<T>[] {
			return items.sort((a, b) => (a.level || 0) - (b.level || 0));
		},

		_autoSortSiblings(parentPath: string): void {
			if (this.isSortingEnabled) this.refreshSiblings(parentPath);
			else this._emitTreeChanged();
		},

		/** Sort one parent's children; collects the orderMember rewrite (if any) into `out`. */
		_sortChildrenOf(parent: LTreeNode<T>, options: SortOptions<T> | undefined, out: NodesReorderContext<T>[]): void {
			const children = parent.children as LTreeNode<T>[];
			if (children.length === 0) return;
			const sorted = this._sortSiblings(children, options);
			parent.children = sorted;
			parent._rev = (parent._rev || 0) + 1;
			// A custom compare / reversed order no longer matches the orderMember values —
			// rewrite them (10, 20, 30…) so the new order persists.
			const om = this.orderMember;
			if (!om || (!options?.compareCallback && options?.direction !== 'desc')) return;
			const changes: NodesReorderContext<T>['changes'] = [];
			sorted.forEach((node, i) => {
				if (!node.data) return;
				const oldOrder = getField(node.data, om) as number | undefined;
				const newOrder = (i + 1) * 10;
				if (oldOrder === newOrder) return;
				(node.data as any)[om] = newOrder;
				changes.push({ path: node.path, oldOrder, newOrder });
			});
			if (changes.length > 0) out.push({ parentPath: parent === root ? '' : parent.path || '', nodes: sorted, changes });
		},

		sortNodes(paths: string | string[], options?: SortOptions<T>): NodesReorderContext<T>[] {
			const out: NodesReorderContext<T>[] = [];
			for (const p of Array.isArray(paths) ? paths : [paths]) {
				const node = isEmptyString(p) ? root : index.get(p);
				if (node) this._sortChildrenOf(node, options, out);
			}
			this._emitTreeChanged();
			return out;
		},

		sortAll(paths?: string | string[] | null, options?: SortOptions<T>): NodesReorderContext<T>[] {
			const out: NodesReorderContext<T>[] = [];
			const list = paths == null ? [] : (Array.isArray(paths) ? paths : [paths]).filter((p) => !isEmptyString(p));
			const targets = list.length === 0 ? [root] : list.map((p) => index.get(p));
			const walk = (node: LTreeNode<T>) => {
				this._sortChildrenOf(node, options, out);
				for (const child of node.children as LTreeNode<T>[]) walk(child);
			};
			for (const t of targets) if (t) walk(t);
			this._emitTreeChanged();
			return out;
		},

		/**
		 * Insert order for a flat batch: parents before children (by level, then
		 * parent path), each sibling group ordered by `_sortSiblings` — so
		 * `sortCallback` only ever sees the children of one parent.
		 */
		_defaultSort: function (self: Ltree<T>, items: LTreeNode<T>[]): LTreeNode<T>[] {
			const groups = new Map<string, { level: number; items: LTreeNode<T>[] }>();
			for (const node of items) {
				const pp = node.parentPath ?? '';
				let g = groups.get(pp);
				if (!g) {
					g = { level: node.level || 0, items: [] };
					groups.set(pp, g);
				}
				g.items.push(node);
			}
			const ordered = [...groups.entries()].sort(([aPath, a], [bPath, b]) => {
				if (a.level !== b.level) return a.level - b.level;
				if (!aPath) return -1;
				if (!bPath) return 1;
				return aPath.localeCompare(bPath);
			});
			const result: LTreeNode<T>[] = [];
			for (const [, g] of ordered) {
				for (const node of self._sortSiblings(g.items)) result.push(node);
			}
			return result;
		},

		_emitTreeChanged: function () {
			changeTracker = Symbol();
			// Invalidate visibleFlatNodes cache
			cachedVisibleFlatNodesTracker = null;
			// Notify listener
			if (onChangeCallback) onChangeCallback();
		},

		...opts
	};
}
