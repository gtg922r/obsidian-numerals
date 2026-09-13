import type { ReferenceDependency } from '../processing/crossNoteResolver';

/** Normalized host event, independent of Obsidian/Dataview callback signatures. */
export type NoteDependencyChange =
	| { readonly kind: 'metadata' | 'modify'; readonly path: string }
	| { readonly kind: 'create' | 'delete'; readonly path: string }
	| { readonly kind: 'rename'; readonly path: string; readonly oldPath: string };

/**
 * Missing notes and repaired fields remain dependencies. Namespace changes can
 * also change which existing file a link resolves to (for example a nearer A.md
 * is created), so resolved links cannot be filtered solely by their old path.
 */
export function dependsOnChange(dependencies: readonly ReferenceDependency[], change: NoteDependencyChange): boolean {
	if (change.kind === 'create' || change.kind === 'delete' || change.kind === 'rename') return dependencies.length > 0;
	return dependencies.some(dependency => dependency.status === 'missing-note' || dependency.resolvedPath === change.path);
}
