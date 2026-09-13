import type {} from 'obsidian';

/** Minimal native DOM helpers, preserving the receiving element/document owner. */
for (const [name, tag] of [['createSpan', 'span'], ['createDiv', 'div']]) {
	Object.defineProperty(HTMLElement.prototype, name, { configurable: true, writable: true,
		value: function (this: HTMLElement, options?: DomElementInfo | string) {
			if (typeof this.createEl === 'function') return this.createEl(tag as keyof HTMLElementTagNameMap, options);
			const child = this.ownerDocument.createElement(tag);
			const info = typeof options === 'string' ? { cls: options } : options;
			if (info?.cls) child.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
			if (info?.text) child.textContent = String(info.text);
			this.appendChild(child); return child;
		} });
}
Object.defineProperty(Document.prototype, 'win', { configurable: true,
	get: function (this: Document) { return { createSpan: () => this.createElement('span') }; } });
