import { EditorView, ViewPlugin, type ViewUpdate, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { type EditorSelection, type EditorState, type Range, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { editorInfoField, editorLivePreviewField, type Editor, type TFile } from 'obsidian';
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

const isLivePreview = (state: EditorState) => state.field(editorLivePreviewField, false) === true;

interface InlineProjection {
 readonly document: EditorState['doc'];
 readonly editor?: Editor;
 readonly file?: TFile;
 readonly path?: string;
 readonly ranges: DecorationSet;
 readonly signal: AbortSignal;
}
const refreshSnapshot = StateEffect.define<InlineProjection>();

/** Pure presentation carrier. Direct decorations may replace source line breaks;
 * viewport-dependent ViewPlugin decorations may not. Keep unmasked full-note
 * ranges so selection and mode transitions never need another evaluation. */
const inlineProjection = StateField.define<{projection?: InlineProjection; decorations: DecorationSet}>({
 create: () => ({decorations: Decoration.none}),
 update(value, transaction) {
  let projection = transaction.docChanged ? undefined : value.projection;
  const state = transaction.state, info = state.field(editorInfoField, false);
  const matches = (candidate: InlineProjection) => !candidate.signal.aborted && candidate.document === state.doc &&
   candidate.editor === info?.editor && candidate.file === (info?.file ?? undefined) && candidate.path === info?.file?.path;
  if (projection && !matches(projection)) projection = undefined;
  // An old queued effect must not replace a newer valid projection, including
  // empty/unmapped projections. Every publication carries the same identity guard.
  for (const effect of transaction.effects) if (effect.is(refreshSnapshot) && matches(effect.value)) projection = effect.value;
  return {projection, decorations: projection && isLivePreview(state)
   ? projection.ranges.update({filter: (from, to) => !selectionOverlapsRange(state.selection, from, to)}) : Decoration.none};
 },
 provide: field => EditorView.decorations.from(field, value => value.decorations),
});

/** The full note is evaluated independently of viewport and selection. This adapter only projects it. */
export function createInlineLivePreviewExtension(registry: SourceRegistry) {
 return ViewPlugin.fromClass(class {
  get decorations(): DecorationSet { return this.destroyed ? Decoration.none : this.view.state.field(inlineProjection).decorations; }
  private readonly input = new TrustedInputRoot();
  private source?: SurfaceSource;
  private sourceId?: string;
  private stopSource = () => {};
  private stopRegistry: () => void;
  private destroyed = false;
  private queued = false;
  private lifetime = new AbortController();
  private projectedState?: object;
  constructor(private readonly view: EditorView) {
   this.stopRegistry = registry.subscribe(() => { if (!registry.active) this.destroy(); else this.changed(); });
   // Initialization may precede DOM attachment; layout reconciliation will prove it later.
   this.bind(); this.schedule();
  }
  observe(event: Event): void { this.input.observe(event, this.view); }
  update(update: ViewUpdate): void {
   const root = this.input.consume(update);
   const rebound = this.bind();
   if (update.docChanged && this.source?.editor) registry.sourceChanged(this.source.editor, root && !rebound);
   if (rebound || update.docChanged || update.viewportChanged ||
    isLivePreview(update.startState) !== isLivePreview(update.state) ||
    syntaxTree(update.startState) !== syntaxTree(update.state)) this.schedule();
  }
  private bind(): boolean {
   const source = registry.fromCodeMirror(this.view, this.view.state.field(editorInfoField, false));
   const sourceId = source && registry.coordinator.current(source.identity)?.sourceId;
   // A reused Editor may own a replacement session/TFile even at the same path.
   // An ordinary text invalidation temporarily hides current(); it is not a new attachment.
   if (source?.identity === this.source?.identity && source?.path === this.source?.path &&
    (sourceId === undefined || sourceId === this.sourceId)) return false;
   this.stopSource(); this.input.clear(); this.source = source; this.sourceId = sourceId;
   this.stopSource = source ? registry.coordinator.subscribe(source.identity, () => this.changed()) : () => {};
   this.refreshLifetime();
   return true;
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
    if (!this.destroyed) {
     this.bind();
     const projection = this.project();
     if (!this.destroyed) this.view.dispatch({effects: refreshSnapshot.of(projection)});
    }
   });
  }
  private project(): InlineProjection {
   this.refreshLifetime();
   const source = this.source, signal = this.lifetime.signal;
   const state = this.view.state, info = state.field(editorInfoField, false);
   const empty: InlineProjection = {document: state.doc, editor: info?.editor, file: info?.file ?? undefined,
    path: info?.file?.path, ranges: Decoration.none, signal};
   if (!source?.editor || !info?.file) return empty;
   const current = registry.coordinator.current(source.identity);
   if (!current || !current.settings.enableInlineNumerals || current.index.source.text !== state.doc.toString()) return empty;
   const snapshot = current.state.status === 'ready' ? current.state.snapshot : undefined;
   const runtime = snapshot && registry.coordinator.renderContext(source.identity, snapshot);
   const decorations: Range<Decoration>[] = [];
   for (const calculation of current.index.calculations) {
    if (calculation.kind !== 'inline') continue;
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
     calculation.expression.text, current.settings.inlineEquationSeparator, Boolean(error), inheritedFormatting(state, calculation.opener.end),
     style, inputTeX, error, signal);
    decorations.push(Decoration.replace({widget}).range(calculation.span.start, calculation.span.end));
   }
   const latest = registry.coordinator.current(source.identity);
   if (this.source !== source || this.view.state !== state || signal.aborted || latest?.state !== current.state ||
    latest.index !== current.index || latest.settings !== current.settings ||
    registry.fromCodeMirror(this.view, info)?.identity !== source.identity) return empty;
   return {document: state.doc, editor: source.editor, file: info.file, path: source.path,
    ranges: Decoration.set(decorations, true), signal};
  }
  destroy(): void {
   if (this.destroyed) return;
   this.destroyed = true; this.lifetime.abort(); this.input.clear(); this.stopSource(); this.stopRegistry();
  }
 }, {
  provide: () => inlineProjection,
  eventObservers: {
   input(event) { this.observe(event); },
   paste(event) { this.observe(event); },
  },
 });
}
