import FlexSearch, { Index, type SearchOptions } from 'flexsearch';

import { type LTreeNode, type DropPosition, createLTreeNode } from './ltree-node';

import { isEmptyString } from '../helpers/string-helpers';
import {
	getLevel,
	getParentPath,
	getPathSegments,
	getRelativePath
} from '../helpers/ltree-helpers';

import type { Ltree, ExpandOptions, SortOptions, NodesReorderContext, Tuple, InsertArrayResult, InsertBranchResult, ReplaceBranchResult } from './types';
import { createSearchIndex } from './flex';
import { Indexer } from './indexer';
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

	// this is absolutely crucial to keep order of sorted items. Segments are just numbers and numbers as properties are always sorted
	// see https://stackoverflow.com/questions/33351816/how-to-prevent-automatic-sort-of-object-numeric-property/51497854#51497854
	const segmentPrefix = 'x';

	// Private state variables
	let root = createLTreeNode<T>();
	let filteredRoot = createLTreeNode<T>();
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
			_indexerBatchSize || 25, // batch size with fallback
			_indexerTimeout || 50 // timeout with fallback
		);
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
				return Object.values(filteredRoot?.children) || [];
			}
			if (!root?.children || !changeTracker) {
				return [];
			}

			return Object.values(root.children);
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
				for (const child of Object.values(node.children)) {
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

			// Clear existing tree data - reset root children
			root.children = {};
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

				if (shouldCalculateParentPath) {
					node.parentPath = getParentPath(node.path, this.treePathSeparator);
				} else node.parentPath = getField(row, _parentPathMember!);

				node.pathSegment = getPathSegments(getRelativePath(node.path, node.parentPath ?? '', this.treePathSeparator), 0, 1, this.treePathSeparator);

				if (!shouldCalculateLevel) node.level = getField(row, _levelMember!);
				else node.level = getLevel(node.path, this.treePathSeparator);

				// Assign data BEFORE the get*Callback evaluations so consumer callbacks
				// reading node.data see the real row (NOTES #12; same as insertBranch).
				node.data = row;

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

				node.data = row;
				return node;
			}).filter((node): node is LTreeNode<T> => node !== null);
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
					undefined, // no progress callback for now
					undefined  // No tree change on completion — indexing doesn't affect visible structure
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
			const parentNode = this.getNodeByPath(parentPath);

			if (!parentNode) {
				return `Node: ${newNode.path} - Could not find parent node: ${parentPath}`;
			}
			if (shouldCalculateLevel) {
				newNode.level = (parentNode.level || 0) + 1;
			}

			const newSegment =
				segmentPrefix + getPathSegments(getRelativePath(newNode?.path, parentPath, this.treePathSeparator), 0, 1, this.treePathSeparator);

			if (!parentNode.children.hasOwnProperty(newSegment)) {
				parentNode.children[newSegment] = newNode;
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
			if (isEmptyString(_searchText)) {
				// Clear filter when search is empty
				filteredRoot.children = {};
				this.isFiltered = false;
				this._emitTreeChanged();
				return;
			}

			if (!_shouldUseInternalSearchIndex) {
				return;
			}

			perfStart(`[${_treeId}] filterNodes:search`);
			const resultIndices = searchIndex!.search(_searchText!, _searchOptions);
			const foundPaths = nodesAt(resultIndices).map((n) => n.path);
			perfEnd(`[${_treeId}] filterNodes:search`, resultIndices.length);

			this.createFilteredTree(foundPaths);
		},

		searchNodes(_searchText: string | null | undefined, _searchOptions?: SearchOptions): LTreeNode<T>[] {
			if (isEmptyString(_searchText)) {
				return [];
			}

			if (!_shouldUseInternalSearchIndex) {
				return [];
			}

			const resultIndices = searchIndex!.search(_searchText!, _searchOptions);
			const foundNodes = nodesAt(resultIndices);

			return foundNodes;
		},

		createFilteredTree(targetPaths: string[]): void {
			perfStart(`[${_treeId}] createFilteredTree`);
			filteredRoot.children = {};
			filteredTree = null;

			// 1. Expand all target paths to include their parents
			const allRequiredPaths = new Set<string>();
			targetPaths.forEach((path) => {
				const segments = path.split(this.treePathSeparator);
				for (let i = 1; i <= segments.length; i++) {
					allRequiredPaths.add(segments.slice(0, i).join(this.treePathSeparator));
				}
			});

			// 2. Build filtered tree with only required paths
			const pathToNode = new Map<string, LTreeNode<T>>();

			// First pass: create copies of all required nodes
			allRequiredPaths.forEach((path) => {
				const originalNode = this.getNodeByPath(path, root);

				if (originalNode) {
					// Deep copy the node but reset children
					const copiedNode: LTreeNode<T> = {
						...originalNode,
						children: {},
						hasChildren: false,
						isExpanded: true // Expand all nodes in filtered tree
					};
					pathToNode.set(path, copiedNode);
				}
			});

			// Second pass: rebuild parent-child relationships
			allRequiredPaths.forEach((path) => {
				const node = pathToNode.get(path);
				if (!node) return;

				const segments = path.split(this.treePathSeparator);
				if (segments.length > 1) {
					// This node has a parent
					const parentPath = segments.slice(0, -1).join(this.treePathSeparator);
					const parentNode = pathToNode.get(parentPath);
					const segment = segmentPrefix + segments[segments.length - 1];

					if (parentNode) {
						parentNode.children[segment] = node;
						parentNode.hasChildren = true;
					}
				}
			});

			// 3. Extract root level nodes for filteredTree
			const rootNodes: LTreeNode<T>[] = [];

			allRequiredPaths.forEach((path) => {
				if (!path.includes(this.treePathSeparator)) {
					// This is a root level node
					const node = pathToNode.get(path);
					if (node) {
						rootNodes.push(node);
					}
				}
			});

			rootNodes.forEach((node) => {
				filteredRoot.children[segmentPrefix + node.path] = node;
			});

			filteredTree = rootNodes;
			this.isFiltered = true;
			this._emitTreeChanged();

			perfEnd(`[${_treeId}] createFilteredTree`, rootNodes.length);

		},

		clearFilter(): void {
			filteredRoot.children = {};
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
				for (const key in node.children) {
					setExpandedRecursive(node.children[key], value);
				}
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
						const segs = p.split(this.treePathSeparator);
						for (let i = 0; i < segs.length; i++) {
							spineSet.add(segs.slice(0, i + 1).join(this.treePathSeparator));
						}
					}
					const isUnderTarget = (p: string) => {
						for (const tp of paths) {
							if (p === tp || p.startsWith(tp + this.treePathSeparator)) return true;
						}
						return false;
					};
					// Walk currently-expanded subtree; collapse off-spine / off-target.
					const trim = (node: LTreeNode<T>) => {
						for (const key in node.children) {
							const child = node.children[key];
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
					let node: LTreeNode<T> | undefined = root;
					const segments = p.split(this.treePathSeparator);
					for (let i = 0; i < segments.length; i++) {
						const segment = segmentPrefix + segments[i];
						if (node && node.children.hasOwnProperty(segment)) {
							node = node.children[segment];
							if (!node.isExpanded) {
								node.isExpanded = true;
								node._rev = (node._rev || 0) + 1;
							}
						} else {
							node = undefined;
							break;
						}
					}
					if (node) setExpandedRecursive(node, true);
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
				for (const key in node.children) {
					collapseRecursive(node.children[key]);
				}
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

		insert: function (path: string, data: T, noEmitChanges: boolean = false): void {
			let node = this.root;

			const segments = path.split(this.treePathSeparator);
			for (let i = 0; i < segments.length; i++) {
				const segment = segmentPrefix + segments[i];

				if (!node.children.hasOwnProperty(segment)) {
					node.children[segment] = createLTreeNode<T>();
				}
				node = node.children[segment]!;
			}

			// Mark as end of path and store data
			if (node.hasChildren) {
				size++;
			}
			node.hasChildren = true;
			node.data = data;

			if (!noEmitChanges) {
				this._emitTreeChanged();
			}
		},

		expandNodes: function (
			path: string | string[],
			options?: ExpandOptions
		) {
			perfStart(`[${_treeId}] expandNodes`);
			const self = this;
			const exclusive = options?.isExclusive ?? false;
			const rootNode = this.isFiltered ? filteredRoot : root;
			const paths = Array.isArray(path) ? path : [path];
			let hasChanges = false;

			if (exclusive) {
				// Spine = union of every ancestor path of every input target.
				// Walk the currently-expanded subtree and collapse anything
				// off-spine. Bump _rev on each mutation so renderers that key
				// off it (the flat keyed list, the toggle icon class) refresh.
				const spineSet = new Set<string>();
				for (const p of paths) {
					const segs = p.split(this.treePathSeparator);
					for (let i = 0; i < segs.length; i++) {
						spineSet.add(segs.slice(0, i + 1).join(this.treePathSeparator));
					}
				}
				const trim = (node: LTreeNode<T>) => {
					for (const key in node.children) {
						const child = node.children[key];
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

			for (const p of paths) {
				let node: LTreeNode<T> | undefined = rootNode;
				const segments = p.split(this.treePathSeparator);
				for (let i = 0; i < segments.length; i++) {
					const segment = segmentPrefix + segments[i];
					if (node && node.children.hasOwnProperty(segment)) {
						node = node.children[segment];
						if (!node.isExpanded) {
							node.isExpanded = true;
							node._rev = (node._rev || 0) + 1;
							hasChanges = true;
						}
					} else {
						break;
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
			const rootNode = this.isFiltered ? filteredRoot : this.root;
			const paths = Array.isArray(path) ? path : [path];
			let hasChanges = false;

			for (const p of paths) {
				let node: LTreeNode<T> | undefined = rootNode;
				const segments = p.split(this.treePathSeparator);
				for (let i = 0; i < segments.length; i++) {
					const segment = segmentPrefix + segments[i];
					if (node && node.children.hasOwnProperty(segment)) {
						node = node.children[segment];
					} else {
						node = undefined;
						break;
					}
				}
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
			let node = _root || (this.isFiltered ? filteredRoot : root);

			if (path) {
				const parts = path.split(this.treePathSeparator);

				for (let i = 0; i < parts.length; i++) {
					const segment = segmentPrefix + parts[i];
					if (!node.children.hasOwnProperty(segment)) {
						return null;
					}
					node = node.children[segment]!;
				}
			}

			return node;
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
			return Object.values(parent.children);
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
			const parent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!parent) return;

			// Get current children as array
			const children = Object.values(parent.children) as LTreeNode<T>[];
			if (children.length === 0) return;

			const sorted = this._sortSiblings(children);

			// Rebuild children object in sorted order
			const newChildren: Record<string, LTreeNode<T>> = {};
			sorted.forEach(child => {
				const segment = segmentPrefix + child.pathSegment;
				newChildren[segment] = child;
			});
			parent.children = newChildren;

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
			// Find source node
			const sourceNode = this.getNodeByPath(sourcePath);
			if (!sourceNode) {
				return { success: false, error: `Source node not found: ${sourcePath}` };
			}

			// Find target node
			const targetNode = this.getNodeByPath(targetPath);
			if (!targetNode) {
				return { success: false, error: `Target node not found: ${targetPath}` };
			}

			// Prevent moving a node into itself or its descendants
			if (targetPath.startsWith(sourcePath + this.treePathSeparator) || targetPath === sourcePath) {
				return { success: false, error: 'Cannot move a node into itself or its descendants' };
			}

			// Get source's current parent
			const sourceParentPath = sourceNode.parentPath || '';
			const sourceParent = sourceParentPath ? this.getNodeByPath(sourceParentPath) : root;
			if (!sourceParent) {
				return { success: false, error: `Source parent not found: ${sourceParentPath}` };
			}

			// Remove source from current parent
			const sourceSegment = segmentPrefix + sourceNode.pathSegment;
			delete sourceParent.children[sourceSegment];

			// Update source parent's hasChildren
			if (Object.keys(sourceParent.children).length === 0) {
				sourceParent.hasChildren = false;
			}

			// Calculate new parent and path
			let newParentPath: string;
			let newParent: LTreeNode<T>;

			if (position === 'child') {
				// Insert as child of target
				newParentPath = targetPath;
				newParent = targetNode;
			} else {
				// Insert as sibling (before or after)
				newParentPath = targetNode.parentPath || '';
				newParent = newParentPath ? this.getNodeByPath(newParentPath)! : root;
			}

			// Generate new path segment (use source's original segment if unique)
			let newSegment = sourceNode.pathSegment;

			// Check if a node with this segment already exists in the new parent (excluding source node itself)
			const existingChild = newParent.children[segmentPrefix + newSegment];
			if (existingChild && existingChild !== sourceNode) {
				// Segment collision - generate a unique segment
				// Try using the source's ID first, then fall back to timestamp
				const sourceId = sourceNode.id?.toString();
				if (sourceId && !newParent.children[segmentPrefix + sourceId]) {
					newSegment = sourceId;
				} else {
					// Generate unique segment with timestamp
					newSegment = `${newSegment}_${Date.now()}`;
				}
			}

			const newPath = newParentPath ? `${newParentPath}${this.treePathSeparator}${newSegment}` : newSegment;
			const oldPath = sourceNode.path;

			// Update source node's path and parentPath
			sourceNode.path = newPath;
			sourceNode.pathSegment = newSegment;
			sourceNode.parentPath = newParentPath || null;
			sourceNode.level = getLevel(newPath, this.treePathSeparator);

			// Update the data object's path if pathMember is defined
			if (this.pathMember && sourceNode.data) {
				(sourceNode.data as any)[this.pathMember] = newPath;
			}

			// Update all descendants' paths recursively
			this._updateDescendantPaths(sourceNode, oldPath, newPath);

			// Insert into new parent
			newParent.hasChildren = true;

			newParent.children[segmentPrefix + newSegment] = sourceNode;
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
			const parent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!parent || block.length === 0) return;
			const inBlock = new Set(block);
			const om = this.orderMember;
			if (om && block.every((n) => n.data)) {
				const targetOrder = (targetNode.data ? getField(targetNode.data, om) : 0) ?? 0;
				const others = (Object.values(parent.children) as LTreeNode<T>[])
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
			const targetKey = segmentPrefix + targetNode.pathSegment;
			const blockEntries = block.map((n) => [segmentPrefix + n.pathSegment, n] as const);
			const newChildren: Record<string, LTreeNode<T>> = {};
			let isPlaced = false;
			for (const [key, child] of Object.entries(parent.children)) {
				if (inBlock.has(child as LTreeNode<T>)) continue;
				if (key === targetKey && position === 'before') { for (const [k, n] of blockEntries) newChildren[k] = n; isPlaced = true; }
				newChildren[key] = child as LTreeNode<T>;
				if (key === targetKey && position === 'after') { for (const [k, n] of blockEntries) newChildren[k] = n; isPlaced = true; }
			}
			if (!isPlaced) for (const [k, n] of blockEntries) newChildren[k] = n;
			parent.children = newChildren;
			this._emitTreeChanged();
		},

		/**
		 * Insert one node next to `targetPath` (`'before'` / `'after'`, as its sibling) or as its
		 * last child (`'child'`, same as {@link addNode} under it). Positioning is moveNode's.
		 */
		insertNode(targetPath: string, data: T, position: DropPosition): { success: boolean; node?: LTreeNode<T>; error?: string } {
			const targetNode = this.getNodeByPath(targetPath);
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
			for (const child of Object.values(node.children) as LTreeNode<T>[]) {
				// Save the old path BEFORE updating, for correct recursive calculation
				const oldChildPath = child.path;

				// Calculate new path by replacing the old base with new base
				const relativePath = oldChildPath.substring(oldBasePath.length);
				const newChildPath = newBasePath + relativePath;

				child.path = newChildPath;
				child.parentPath = node.path;
				child.level = getLevel(newChildPath, this.treePathSeparator);

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
			const node = this.getNodeByPath(path);
			if (!node) {
				return { success: false, error: `Node not found: ${path}` };
			}

			// Get parent
			const parentPath = node.parentPath || '';
			const parent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!parent) {
				return { success: false, error: `Parent not found: ${parentPath}` };
			}

			// Leave the search index too (node + subtree — the subtree goes with it), else it stays findable
			const removedPaths = new Set<string>([node.path]);
			const collectRemoved = (n: LTreeNode<T>) => {
				for (const child of Object.values(n.children)) {
					removedPaths.add(child.path);
					collectRemoved(child);
				}
			};
			collectRemoved(node);
			dropFromSearch(removedPaths);

			// Remove from parent
			const segment = segmentPrefix + node.pathSegment;
			delete parent.children[segment];

			// Update parent's hasChildren
			if (Object.keys(parent.children).length === 0) {
				parent.hasChildren = false;
			}

			// Update node count
			if (includeDescendants) {
				const countDescendants = (n: LTreeNode<T>): number => {
					let count = 1;
					for (const child of Object.values(n.children)) {
						count += countDescendants(child);
					}
					return count;
				};
				nodeCount -= countDescendants(node);
			} else {
				nodeCount--;
			}

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
			const parent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!parent && parentPath) {
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
			if (this.getNodeByPath(newPath)) {
				return { success: false, error: `Node already exists at path: ${newPath}` };
			}

			// Create the node
			const newNode = createLTreeNode<T>();
			newNode.treeId = _treeId || '';
			newNode.id = _idMember && data ? (data as any)[_idMember] : undefined;
			newNode.path = newPath;
			newNode.pathSegment = segment;
			newNode.parentPath = parentPath || null;
			newNode.level = getLevel(newPath, this.treePathSeparator);
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
			const targetParent = parent || root;
			targetParent.children[segmentPrefix + pathSegment] = newNode;
			targetParent.hasChildren = true;

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
			const node = this.getNodeByPath(path);
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
				if (node.children && Object.keys(node.children).length > 0) {
					for (const child of Object.values(node.children)) {
						copyRecursive(child, newNode.path);
					}
				}

				return newNode;
			};

			// Start the recursive copy
			const rootNode = copyRecursive(sourceNode, targetParentPath);

			if (!rootNode) {
				return { success: false, count: 0, error: 'Failed to copy root node' };
			}

			// Handle positioning relative to sibling if specified
			if (siblingPath && position && rootNode.data) {
				const siblingNode = this.getNodeByPath(siblingPath);
				if (siblingNode) {
					const parent = targetParentPath ? this.getNodeByPath(targetParentPath) : root;
					if (parent) {
						if (this.orderMember) {
							// orderMember mode: calculate order value, then let refreshSiblings sort
							const siblings = Object.values(parent.children) as LTreeNode<T>[];
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
							// No orderMember: manually position in children object relative to sibling
							const siblingSegment = segmentPrefix + siblingNode.pathSegment;
							const rootSegment = segmentPrefix + rootNode.pathSegment;
							const newChildren: Record<string, LTreeNode<T>> = {};
							for (const [key, child] of Object.entries(parent.children)) {
								if (key === rootSegment) continue;
								if (key === siblingSegment && position === 'before') {
									newChildren[rootSegment] = rootNode;
								}
								newChildren[key] = child as LTreeNode<T>;
								if (key === siblingSegment && position === 'after') {
									newChildren[rootSegment] = rootNode;
								}
							}
							if (!newChildren[rootSegment]) {
								newChildren[rootSegment] = rootNode;
							}
							parent.children = newChildren;
							this._emitTreeChanged();
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
			const targetParent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!targetParent && parentPath) {
				return { success: false, count: 0, failed: [], parentNode: null, error: 'Parent not found: ' + parentPath };
			}
			const parentNode = targetParent || root;

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

					if (shouldCalculateParentPath) {
						node.parentPath = getParentPath(node.path, sep);
					} else node.parentPath = getField(row, _parentPathMember!);

					node.pathSegment = getPathSegments(getRelativePath(node.path, node.parentPath ?? '', sep), 0, 1, sep);

					if (!shouldCalculateLevel) node.level = getField(row, _levelMember!);
					else node.level = getLevel(node.path, sep);

					// Assign data BEFORE the get*Callback evaluations so consumer
					// callbacks reading node.data see the real row.
					node.data = row;

					// isExpanded: callback > member > expandLevel
					if (_getIsExpandedCallback) node.isExpanded = _getIsExpandedCallback(node);
					else if (!shouldCalculateIsExpanded) node.isExpanded = getField(row, _isExpandedMember!);
					else if (_expandLevel) node.isExpanded = (node.level ?? 0) <= _expandLevel;

					if (_getIsSelectableCallback) node.isSelectable = _getIsSelectableCallback(node);
					else if (!shouldCalculateIsSelectable) node.isSelectable = getField(row, _isSelectableMember!);

					if (_getIsCheckedCallback) node.isChecked = _getIsCheckedCallback(node);
					else if (!shouldCalculateIsChecked) node.isChecked = getField(row, _isCheckedMember!);

					if (_getIsDraggableCallback) node.isDraggable = _getIsDraggableCallback(node);
					else if (!shouldCalculateIsDraggable) node.isDraggable = getField(row, _isDraggableMember!);
					if (!shouldCalculateIsCollapsible) node.isCollapsible = getField(row, _isCollapsibleMember!);
					if (_getIsDropAllowedCallback) node.isDropAllowed = _getIsDropAllowedCallback(node);
					else if (!shouldCalculateIsDropAllowed) node.isDropAllowed = getField(row, _isDropAllowedMember!);
					if (!shouldCalculateAllowedDropPositions) node.allowedDropPositions = getField(row, _allowedDropPositionsMember!);

					if (!shouldCalculateHasChildren) node.hasChildren = getField(row, _hasChildrenMember!);

					return node;
				})
				.filter((node): node is LTreeNode<T> => node !== null);

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
				if (this.getNodeByPath(node.path)) {
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
				const parent = pp ? this.getNodeByPath(pp) : root;
				if (!parent) continue;
				const children = Object.values(parent.children) as LTreeNode<T>[];
				if (children.length === 0) continue;
				const newChildren: Record<string, LTreeNode<T>> = {};
				this._sortSiblings(children).forEach((child) => {
					newChildren[segmentPrefix + child.pathSegment] = child;
				});
				parent.children = newChildren;
			}

			// Update hasChildren (+ the hasChildren member) on every parent that received children
			for (const pp of affectedParents) {
				const parent = pp ? this.getNodeByPath(pp) : root;
				if (!parent) continue;
				parent.hasChildren = Object.keys(parent.children).length > 0;
				if (_hasChildrenMember && parent.data) {
					(parent.data as any)[_hasChildrenMember] = parent.hasChildren;
				}
			}

			// Bump _rev on all affected parents AND their ancestors up to root
			const bumpedPaths = new Set<string>();
			for (const pp of affectedParents) {
				let walkPath = pp;
				while (walkPath && !bumpedPaths.has(walkPath)) {
					bumpedPaths.add(walkPath);
					const ancestor = this.getNodeByPath(walkPath);
					if (ancestor) ancestor._rev = (ancestor._rev || 0) + 1;
					const sepIdx = walkPath.lastIndexOf(sep);
					walkPath = sepIdx > 0 ? walkPath.substring(0, sepIdx) : '';
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
			const targetNode = this.getNodeByPath(targetPath);
			if (!targetNode) {
				return { success: false, count: 0, failed: [], parentNode: null, error: 'Target not found: ' + targetPath };
			}
			if (position === 'child') return this.addBranch(targetPath, data);
			const parentPath = targetNode.parentPath || '';
			const parent = parentPath ? this.getNodeByPath(parentPath) : root;
			const before = new Set(Object.values(parent?.children ?? {}) as LTreeNode<T>[]);
			const result = this.addBranch(parentPath, data);
			if (!result.success || !parent) return result;
			const rank = new Map<unknown, number>();
			data.forEach((d, i) => { if (!rank.has(d)) rank.set(d, i); });
			const block = (Object.values(parent.children) as LTreeNode<T>[])
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
			const targetParent = parentPath ? this.getNodeByPath(parentPath) : root;
			if (!targetParent && parentPath) {
				return { success: false, count: 0, failed: [], parentNode: null, removed: 0, added: 0, error: 'Parent not found: ' + parentPath };
			}
			const parentNode = targetParent || root;

			// Collect every descendant path (search-index consistency + the removed count)
			const pathsToRemove = new Set<string>();
			const collectPaths = (n: LTreeNode<T>) => {
				for (const child of Object.values(n.children)) {
					pathsToRemove.add(child.path);
					collectPaths(child);
				}
			};
			collectPaths(parentNode);
			const removedCount = pathsToRemove.size;
			// The search index is keyed by flatTreeNodes POSITION — filtering the array
			// would shift every later position and map hits to the wrong nodes. Tombstone
			// the removed slots instead and drop them from the index (+ its pending queue).
			dropFromSearch(pathsToRemove);

			// Clear children
			parentNode.children = {};
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
		removeBranch(path: string, keepParent?: boolean): { success: boolean; count: number; error?: string } {
			const node = this.getNodeByPath(path);
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
					for (const child of Object.values(n.children)) {
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
				for (const child of Object.values(node.children)) {
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
				for (const child of Object.values(node.children)) {
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
				for (const child of Object.values(node.children)) {
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
			const children = Object.values(parent.children) as LTreeNode<T>[];
			if (children.length === 0) return;
			const sorted = this._sortSiblings(children, options);
			const newChildren: Record<string, LTreeNode<T>> = {};
			for (const child of sorted) newChildren[segmentPrefix + child.pathSegment] = child;
			parent.children = newChildren;
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
				const node = isEmptyString(p) ? root : this.getNodeByPath(p);
				if (node) this._sortChildrenOf(node, options, out);
			}
			this._emitTreeChanged();
			return out;
		},

		sortAll(paths?: string | string[] | null, options?: SortOptions<T>): NodesReorderContext<T>[] {
			const out: NodesReorderContext<T>[] = [];
			const list = paths == null ? [] : (Array.isArray(paths) ? paths : [paths]).filter((p) => !isEmptyString(p));
			const targets = list.length === 0 ? [root] : list.map((p) => this.getNodeByPath(p));
			const walk = (node: LTreeNode<T>) => {
				this._sortChildrenOf(node, options, out);
				for (const child of Object.values(node.children) as LTreeNode<T>[]) walk(child);
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
