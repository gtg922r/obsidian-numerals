import { ReferenceDependency } from '../../src/processing/crossNoteResolver';
import { dependsOnChange } from '../../src/evaluation/dependencies';

describe('note dependency invalidation', () => {
	const resolved: ReferenceDependency = {start: 0, end: 14, fullMatch: '[[A]].$value', noteName: 'A', propertyPath: '$value',
		sourcePath: 'Folder/Note.md', resolvedPath: 'A.md', status: 'resolved'};

	it('refreshes repaired fields and changed typed values', () => {
		expect(dependsOnChange([{...resolved, status: 'unavailable-property'}], {kind: 'metadata', path: 'A.md'})).toBe(true);
		expect(dependsOnChange([resolved], {kind: 'modify', path: 'A.md'})).toBe(true);
		expect(dependsOnChange([resolved], {kind: 'metadata', path: 'Other.md'})).toBe(false);
	});

	it('re-resolves missing notes and link precedence after namespace changes', () => {
		const missing = {...resolved, resolvedPath: undefined, status: 'missing-note' as const};
		expect(dependsOnChange([missing], {kind: 'create', path: 'Folder/A.md'})).toBe(true);
		expect(dependsOnChange([missing], {kind: 'metadata', path: 'Folder/A.md'})).toBe(true);
		expect(dependsOnChange([resolved], {kind: 'create', path: 'Folder/A.md'})).toBe(true);
		expect(dependsOnChange([resolved], {kind: 'rename', path: 'Folder/A.md', oldPath: 'Folder/Other.md'})).toBe(true);
		expect(dependsOnChange([resolved], {kind: 'delete', path: 'A.md'})).toBe(true);
		expect(dependsOnChange([], {kind: 'create', path: 'A.md'})).toBe(false);
	});

	it('retries unresolved names when metadata catches up after a create or rename event', () => {
		const missing = {...resolved, resolvedPath: undefined, status: 'missing-note' as const};
		expect(dependsOnChange([missing], {kind: 'metadata', path: 'A.md'})).toBe(true);
		expect(dependsOnChange([missing], {kind: 'modify', path: 'Folder/A.md'})).toBe(true);
		// An unresolved note has no trustworthy resolved path to filter against.
		expect(dependsOnChange([missing], {kind: 'metadata', path: 'Other.md'})).toBe(true);
		expect(dependsOnChange([], {kind: 'metadata', path: 'A.md'})).toBe(false);
	});
});
