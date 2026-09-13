import { renderMath, finishRenderMath } from 'obsidian';

/** Own both synchronous MathJax calls and its asynchronous completion. */
export function renderOwnedMath(container: HTMLElement, tex: string, signal: AbortSignal, displayMode = true): void {
	if (signal.aborted) return;
	void (async () => {
		try {
			const output = renderMath(tex, displayMode);
			await finishRenderMath();
			if (!signal.aborted) container.append(output);
		} catch (error: unknown) {
			if (signal.aborted) return;
			container.classList.add('numerals-error-message');
			container.textContent = `Unable to render math: ${error instanceof Error ? error.message : String(error)}`;
		}
	})();
}
