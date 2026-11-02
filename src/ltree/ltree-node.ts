export type NodeId = string | number;
export type DropPosition = 'before' | 'after' | 'child';

export enum VisualState {
	indeterminate = "indeterminate",
	checked = "true",
	unchecked = "false",
}

export interface LTreeNode<T> {
	treeId: string;
	id: NodeId;
	path: string;
	pathSegment: string;
	parentPath: string | null | undefined;
	level: number | null | undefined;

	/** Direct children in display order. */
	children: LTreeNode<T>[];
	hasChildren: boolean;
	data: T | null | undefined;

	useCallback: boolean;
	priority: number | null | undefined;

	isDraggable: boolean;
	isCollapsible: boolean;
	isDropAllowed: boolean;
	allowedDropPositions: DropPosition[] | null | undefined;

	isInsertAllowed: boolean;
	isNestAllowed: boolean;
	isCheckboxVisible: boolean | null | undefined;

	visualState: VisualState;
	isExpanded: boolean;
	/** Checkbox state. Independent from `isSelected`. Mirrors svelte-treeview rc06. */
	isChecked: boolean;
	/** Membership in `selectedPaths` (Ctrl/Shift+click multi-select). Distinct from `isChecked`. */
	isSelected: boolean;

	isSelectable: boolean;

	_rev: number;
}

export function createLTreeNode<T>(data?: Partial<LTreeNode<T>>): LTreeNode<T> {
	return {
		treeId: "",
		path: "",
		pathSegment: "",
		parentPath: undefined,
		level: undefined,
		id: -1,

		children: [],
		hasChildren: false,
		data: undefined,

		useCallback: false,
		priority: undefined,
		isDraggable: true,
		isCollapsible: true,
		isDropAllowed: true,
		allowedDropPositions: undefined,
		isInsertAllowed: true,
		isNestAllowed: true,
		isCheckboxVisible: false,
		visualState: VisualState.unchecked,
		isExpanded: false,
		isChecked: false,
		isSelected: false,

		isSelectable: true,

		_rev: 0,
		...data
	};
}
