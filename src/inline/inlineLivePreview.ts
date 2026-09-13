import { EditorView, ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { type EditorSelection, type EditorState, type Range, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { NumeralsRenderStyle, InlineNumeralsMode } from '../numerals.types';
import type { FormattedResult } from '../formatting';
import { SourceRegistry, type SurfaceSource } from '../host/sourceRegistry';
import { TrustedInputRoot } from '../host/trustedInput';
import { inputPresentation } from '../host/presentation';
import { renderInlinePresentation } from './inlineRenderer';

const FORMATTING_CLASS_MAP: Record<string, string> = {
	strong: 'cm-strong',
	em: 'cm-em',
	highlight: 'cm-highlight',
	strikethrough: 'cm-strikethrough',
};

/**
 * Extract inherited CSS classes from Obsidian/CodeMirror token class metadata.
 *
 * When inline code appears inside `**bold**` or `*italic*`, the Lezer
 * token carries those formatting flags. We propagate them to the widget
 * so the rendered result matches the surrounding text style.
 */
export function getFormattingClasses(tokenProps: string | undefined): string[] {
	if (!tokenProps) return [];
	const propSet = tokenProps.split(' ');
	const classes: string[] = [];
	for (const prop of propSet) {
		const cls = FORMATTING_CLASS_MAP[prop];
		if (cls) classes.push(cls);
	}
	return classes;
}

/** CM stream token names encode their presentation classes with underscores.
 * Grammar-based Markdown parsers instead expose the enclosing emphasis nodes. */
function inheritedFormatting(state: EditorState, offset: number): string[] {
 const classes = new Set<string>();
 const enclosing: Record<string, string> = {StrongEmphasis: 'cm-strong', Emphasis: 'cm-em',
  Strikethrough: 'cm-strikethrough', Highlight: 'cm-highlight'};
 for (let node = syntaxTree(state).resolveInner(offset, 1); node; node = node.parent!) {
  for (const name of getFormattingClasses(node.type.name.replace(/_/g, ' '))) classes.add(name);
  if (enclosing[node.type.name]) classes.add(enclosing[node.type.name]);
 }
 return [...classes];
}

export function selectionOverlapsRange(
	selection: EditorSelection,
	from: number,
	to: number,
): boolean {
	for (const range of selection.ranges) {
		if (range.from <= to && range.to >= from) {
			return true;
		}
	}
	return false;
}


export class InlineNumeralsWidget extends WidgetType {
 private readonly lifetimes = new WeakMap<HTMLElement, {controller: AbortController; stop: () => void}>();
 constructor(private readonly formattedResult: FormattedResult, private readonly mode: InlineNumeralsMode,
  private readonly rawExpression: string, private readonly separator: string, private readonly isError: boolean,
  private readonly formattingClasses: string[] = [], private readonly renderStyle = NumeralsRenderStyle.Plain,
  private readonly inputTeX?: string, private readonly error = 'Unable to evaluate this calculation.',
  private readonly generationSignal?: AbortSignal) { super(); }
 eq(other: InlineNumeralsWidget): boolean {
  return this.formattedResult.text === other.formattedResult.text && this.formattedResult.tex === other.formattedResult.tex &&
   this.formattedResult.canonical === other.formattedResult.canonical && this.mode === other.mode &&
   this.rawExpression === other.rawExpression && this.separator === other.separator && this.isError === other.isError &&
   this.renderStyle === other.renderStyle && this.inputTeX === other.inputTeX && this.error === other.error &&
   this.generationSignal === other.generationSignal &&
   this.formattingClasses.join(' ') === other.formattingClasses.join(' ');
 }
 toDOM(view?: EditorView): HTMLElement {
  const span = (view?.dom.ownerDocument ?? activeDocument).createElement('span');
  span.classList.add('cm-inline-code', ...this.formattingClasses);
  const controller = new AbortController(), abort = () => controller.abort();
  if (this.generationSignal?.aborted) controller.abort();
  else this.generationSignal?.addEventListener('abort', abort, {once: true});
  this.lifetimes.set(span, {controller, stop: () => this.generationSignal?.removeEventListener('abort', abort)});
  renderInlinePresentation(span, {formattedResult: this.formattedResult, mode: this.mode, rawExpression: this.rawExpression,
   separator: this.separator, renderStyle: this.renderStyle, inputTeX: this.inputTeX,
   error: this.isError ? this.error : undefined}, controller.signal);
  return span;
 }
 destroy(dom: HTMLElement): void {
  const lifetime = this.lifetimes.get(dom); lifetime?.controller.abort(); lifetime?.stop(); this.lifetimes.delete(dom);
 }
}

const refreshSnapshot = StateEffect.define<null>();
const isLivePreview = (state: EditorState) => state.field(editorLivePreviewField, false) === true;

/** The full note is evaluated independently of viewport and selection. This adapter only projects it. */
export function createInlineLivePreviewExtension(registry: SourceRegistry) {
 return ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;
  private readonly input = new TrustedInputRoot();
  private source?: SurfaceSource;
  private stopSource = () => {};
  private stopRegistry: () => void;
  private destroyed = false;
  private queued = false;
  private lifetime = new AbortController();
  private projectedState?: object;
  constructor(private readonly view: EditorView) {
   this.stopRegistry = registry.subscribe(() => { if (!registry.active) this.destroy(); else this.changed(); });
   // Initialization may precede DOM attachment; layout reconciliation will prove it later.
   this.bind(); this.rebuild();
  }
  observe(event: Event): void { this.input.observe(event, this.view); }
  update(update: ViewUpdate): void {
   const root = this.input.consume(update);
   this.bind();
   if (update.docChanged && this.source?.editor) registry.sourceChanged(this.source.editor, root);
   if (update.docChanged || update.selectionSet || update.viewportChanged ||
    isLivePreview(update.startState) !== isLivePreview(update.state) ||
    update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshSnapshot)))) this.rebuild();
  }
  private bind(): void {
   const source = registry.fromCodeMirror(this.view, this.view.state.field(editorInfoField, false));
   if (source?.identity === this.source?.identity) return;
   this.stopSource(); this.input.clear(); this.source = source;
   this.stopSource = source ? registry.coordinator.subscribe(source.identity, () => this.changed()) : () => {};
   this.refreshLifetime();
  }
  private refreshLifetime(): void {
   const state = this.source && registry.coordinator.current(this.source.identity)?.state;
   if (state === this.projectedState) return;
   this.projectedState = state; this.lifetime.abort(); this.lifetime = new AbortController();
  }
  private changed(): void { this.refreshLifetime(); this.schedule(); }
  private schedule(): void {
   if (this.destroyed || this.queued) return;
   this.queued = true;
   void Promise.resolve().then(() => {
    this.queued = false;
    if (!this.destroyed) this.view.dispatch({effects: refreshSnapshot.of(null)});
   });
  }
  private rebuild(): void {
   this.refreshLifetime();
   this.decorations = Decoration.none;
   if (!this.source || !isLivePreview(this.view.state)) return;
   const current = registry.coordinator.current(this.source.identity);
   if (!current || !current.settings.enableInlineNumerals || current.index.source.text !== this.view.state.doc.toString()) return;
   const snapshot = current.state.status === 'ready' ? current.state.snapshot : undefined;
   const runtime = snapshot && registry.coordinator.renderContext(this.source.identity, snapshot);
   const decorations: Range<Decoration>[] = [];
   for (const calculation of current.index.calculations) {
    if (calculation.kind !== 'inline' || !this.view.visibleRanges.some(range => range.from < calculation.span.end && range.to > calculation.span.start) ||
     selectionOverlapsRange(this.view.state.selection, calculation.span.start, calculation.span.end)) continue;
    const result = snapshot?.calculations.find(item => item.calculationId === calculation.id);
    let error = result?.diagnostic?.message ?? (current.state.status === 'error' ? current.state.message :
     !snapshot ? 'Updating calculation…' : !result ? snapshot.diagnostics[0]?.message ?? 'Calculation unavailable.' : undefined);
    let formatted: FormattedResult = {text: '', tex: '', canonical: ''};
    let inputTeX: string | undefined;
    const style = calculation.renderStyle === 'tex' ? NumeralsRenderStyle.TeX : NumeralsRenderStyle.Plain;
    if (snapshot && result && !error) {
     const output = snapshot.format(calculation.id, 0);
     if ('diagnostic' in output) error = output.diagnostic.message;
     else formatted = output.value;
     if (runtime && calculation.mode === 'equation') {
      try { inputTeX = inputPresentation(result.rows[0]?.processedInput ?? '', calculation.expression.text, style, runtime.engine).inputTeX; }
      catch (failure: unknown) { error = failure instanceof Error ? failure.message : String(failure); }
     }
    }
    // Syntax metadata controls appearance only; all values/order come from the full-note snapshot.
    const widget = new InlineNumeralsWidget(formatted, calculation.mode === 'equation' ? InlineNumeralsMode.Equation : InlineNumeralsMode.ResultOnly,
     calculation.expression.text, current.settings.inlineEquationSeparator, Boolean(error), inheritedFormatting(this.view.state, calculation.opener.end),
     style, inputTeX, error, this.lifetime.signal);
    decorations.push(Decoration.replace({widget}).range(calculation.span.start, calculation.span.end));
   }
   this.decorations = Decoration.set(decorations, true);
  }
  destroy(): void {
   if (this.destroyed) return;
   this.destroyed = true; this.lifetime.abort(); this.input.clear(); this.stopSource(); this.stopRegistry(); this.decorations = Decoration.none;
  }
 }, {
  decorations: plugin => plugin.decorations,
  eventObservers: {
   input(event) { this.observe(event); },
   paste(event) { this.observe(event); },
  },
 });
}
