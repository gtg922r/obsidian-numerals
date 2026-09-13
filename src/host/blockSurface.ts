import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { NumeralsRenderStyle } from '../numerals.types';
import { applyBlockStyles, renderDiagnostic, renderNumeralsBlock } from '../rendering/orchestrator';
import { bindBlock } from './occurrenceBinding';
import { prepareBlockPresentation, storedResultDiffers, STORED_RESULT_GUIDANCE } from './presentation';
import { SourceRegistry, type SurfaceSource } from './sourceRegistry';
import { SurfaceSubscription } from './surfaceSubscription';
import type { SourceSnapshotState } from './snapshotCoordinator';
import type { BlockCalculationSource } from '../evaluation/sourceIndex';

export class BlockSurface extends MarkdownRenderChild {
	private readonly subscription: SurfaceSubscription;
	private disposed = false;
	private binding?: {source: SurfaceSource; state: SourceSnapshotState; calculation: BlockCalculationSource};

	constructor(readonly element: HTMLElement, readonly context: MarkdownPostProcessorContext,
		private sourceText: string, private style: NumeralsRenderStyle | undefined,
		private readonly registry: SourceRegistry, private readonly app: App, private readonly released: () => void) {
		super(element);
		this.subscription = new SurfaceSubscription(registry, element, context, (source, current, signal) => {
			element.empty(); this.binding = undefined;
			if (!source || !current) { renderDiagnostic(element, source?.diagnostic ?? 'Waiting for the complete source note.'); return; }
			if (current.state.status !== 'ready') {
				renderDiagnostic(element, current.state.status === 'error' ? current.state.message : 'Updating calculation…'); return;
			}
			const snapshot = current.state.snapshot;
			const indexed = bindBlock(current.index, context.getSectionInfo(element), this.sourceText);
			const calculation = indexed && snapshot.calculations.find(item => item.calculationId === indexed.id);
			const runtime = registry.coordinator.renderContext(source.identity, snapshot);
			if (!indexed || indexed.kind !== 'block' || !calculation || !runtime) {
				renderDiagnostic(element, snapshot.diagnostics[0]?.message ?? 'Calculation source identity is incomplete or ambiguous in this rendered section.'); return;
			}
			this.binding = {source, state: current, calculation: indexed};
			const renderStyle = this.style ?? current.settings.defaultRenderStyle;
			applyBlockStyles({el: element, settings: current.settings, blockRenderStyle: renderStyle,
				hasEmitters: Boolean(calculation.block?.blockInfo.emitter_lines.length)});
			const presentation = prepareBlockPresentation(snapshot, calculation, current.settings, renderStyle, runtime.engine);
			renderNumeralsBlock(element, presentation.lines, {renderStyle, settings: current.settings, signal});
			if (calculation.diagnostic) renderDiagnostic(element, calculation.diagnostic.message, calculation.diagnostic.input);
			for (const diagnostic of presentation.diagnostics) renderDiagnostic(element, diagnostic.message, diagnostic.input);
			for (const diagnostic of snapshot.diagnostics.filter(item => item.kind === 'metadata' || item.kind === 'configuration')) {
				element.createDiv({cls: 'numerals-warning', text: diagnostic.message});
			}
			if (current.insertionExhausted && storedResultDiffers(snapshot, calculation)) {
				element.createDiv({cls: 'numerals-warning', text: STORED_RESULT_GUIDANCE});
			}
			if (!source.editor) {
				const button = element.createEl('button', {text: 'Open source note'});
				button.addEventListener('click', () => { if (!signal.aborted) void app.workspace.openLinkText(source.path, context.sourcePath); }, {signal});
			}
		}, message => renderDiagnostic(element, message));
		this.registerDomEvent(element, 'click', event => this.navigate(event));
	}

	refresh(source: string = this.sourceText, style = this.style): void {
		if (this.disposed) return;
		this.sourceText = source; this.style = style; this.subscription.refresh();
	}

	dispose(): void { if (!this.disposed) { this.disposed = true; this.binding = undefined; this.subscription.dispose(); this.released(); } }
	onunload(): void { this.dispose(); }

	private navigate(event: MouseEvent): void {
		const binding = this.binding;
		if (!binding?.source.editor || event.button !== 0) return;
		const target = event.target;
		const NodeType = this.element.ownerDocument.defaultView?.Node;
		if (!NodeType || !(target instanceof NodeType)) return;
		const element = target.nodeType === NodeType.ELEMENT_NODE ? target as Element : target.parentElement;
		const line = element?.closest<HTMLElement>('.numerals-line');
		if (!line || !this.element.contains(line)) return;
		const rowIndex = Number(line.dataset.sourceLine);
		if (!Number.isInteger(rowIndex)) return;
		const row = binding.calculation.rows[rowIndex];
		const current = this.registry.coordinator.current(binding.source.identity);
		if (!row || current?.state !== binding.state.state || !this.registry.fromEditor(binding.source.editor)) return;
		// Display transformations can remove markup; navigate to the mapped physical
		// expression start instead of inferring a character by substring alignment.
		const start = row.projection.segments.find(segment => segment.kind === 'copy')?.source.start ?? row.span.start;
		binding.source.editor.setCursor(binding.source.editor.offsetToPos(start));
		binding.source.editor.focus();
	}
}
