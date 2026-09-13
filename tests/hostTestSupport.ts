import type { App, EventRef } from 'obsidian';

export class TestEvents {
	private entries = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
	on = jest.fn((name: string, callback: (...args: unknown[]) => void): EventRef => {
		const reference = {}; this.entries.set(reference, { name, callback }); return reference as EventRef;
	});
	offref = jest.fn((reference: EventRef): void => { this.entries.delete(reference); });
	fire(name: string, ...args: unknown[]): void {
		for (const entry of [...this.entries.values()]) if (entry.name === name) entry.callback(...args);
	}
	get size(): number { return this.entries.size; }
}

export function createTestHost() {
	const cacheEvents = new TestEvents(), vaultEvents = new TestEvents();
	const files = new Map<string, { path: string }>();
	const frontmatter = new Map<string, Record<string, unknown>>();
	const app = {
		vault: { on: vaultEvents.on, offref: vaultEvents.offref, getAbstractFileByPath: (path: string) => files.get(path) ?? null },
		metadataCache: { on: cacheEvents.on, offref: cacheEvents.offref,
			getFileCache: (file: { path: string }) => ({ frontmatter: frontmatter.get(file.path) ?? {} }),
			getFirstLinkpathDest: (name: string) => files.get(name.endsWith('.md') ? name : `${name}.md`) ?? null,
		},
		workspace: { iterateAllLeaves: jest.fn() },
	};
	return { app: app as unknown as App, cacheEvents, vaultEvents, files, frontmatter };
}

export function installHostDom(): void {
	Object.defineProperty(HTMLElement.prototype, 'empty', { configurable: true, value(this: HTMLElement) { this.textContent = ''; } });
	Object.defineProperty(HTMLElement.prototype, 'addClass', { configurable: true, value(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); } });
	Object.defineProperty(HTMLElement.prototype, 'createEl', { configurable: true, value(this: HTMLElement, tag: string, options?: { cls?: string; text?: string }) {
		const element = this.ownerDocument.createElement(tag);
		if (options?.cls) element.className = options.cls;
		if (options?.text) element.textContent = options.text;
		this.appendChild(element); return element;
	} });
}
