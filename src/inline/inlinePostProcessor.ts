import { type MarkdownPostProcessorContext, MarkdownRenderChild, type MarkdownSectionInformation } from 'obsidian';
import { type NumeralsSettings, InlineNumeralsMode } from '../numerals.types';
import { getInlineTriggers, parseInlineExpression } from './inlineParser';
import { renderInlinePresentation } from './inlineRenderer';
import { SourceRegistry, observedContextContainer } from '../host/sourceRegistry';
import { SurfaceSubscription } from '../host/surfaceSubscription';
import { bindReadingCodes } from '../host/occurrenceBinding';
import { inputPresentation } from '../host/presentation';

const inlineClasses = ['numerals-inline', 'numerals-inline-tex', 'numerals-inline-equation', 'numerals-inline-result', 'numerals-inline-error'];

/** Each code element retains its original source and releases its section on host unload. */
class InlineOccurrence extends MarkdownRenderChild {
	source: string;
	readonly originalTitle: string;
	readonly ownershipPath: string;
	disposed = false;
	private renderedNodes: Node[] | undefined;
	private limitation?: HTMLElement;

	constructor(readonly code: HTMLElement, readonly context: MarkdownPostProcessorContext,
		readonly refresh: () => void, private readonly released: () => void) {
		super(code);
		this.source = code.dataset.numeralsInlineSource ?? code.innerText ?? code.textContent ?? '';
		this.originalTitle = code.title;
		this.ownershipPath = context.sourcePath;
	}

	private ownsPresentation(): boolean {
		return this.renderedNodes !== undefined && this.renderedNodes.length === this.code.childNodes.length &&
			this.renderedNodes.every((node, index) => node === this.code.childNodes[index]);
	}

	/** External DOM replacement is new source; our own transformed DOM is not. */
	reconcileSource(): boolean {
		if (this.ownsPresentation()) return false;
		const text = this.code.innerText ?? this.code.textContent ?? '';
		const changed = this.renderedNodes !== undefined || text !== this.source;
		if (this.renderedNodes) this.clearOwnership();
		this.source = text;
		return changed;
	}

	markRendered(): void {
		this.renderedNodes = Array.from(this.code.childNodes);
		this.code.dataset.numeralsInlineSource = this.source;
	}

	private clearOwnership(): void {
		this.renderedNodes = undefined;
		this.code.classList.remove(...inlineClasses);
		this.code.title = this.originalTitle;
		delete this.code.dataset.numeralsInlineSource;
	}

	showLimitation(message: string): void {
		this.limitation?.remove();
		const element = this.code.ownerDocument.createElement('span');
		element.className = 'numerals-inline-error';
		element.textContent = ` (${message})`;
		this.code.after(element); this.limitation = element;
	}

	restore(): void {
		this.limitation?.remove(); this.limitation = undefined;
		if (!this.renderedNodes) return;
		if (this.ownsPresentation()) this.code.textContent = this.source;
		this.clearOwnership();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.restore();
		this.released();
	}

	onunload(): void { this.dispose(); }
}


export interface InlinePostProcessor {
 (el: HTMLElement, ctx: MarkdownPostProcessorContext): void;
 dispose(): void;
}

interface ReadingSection {
 readonly root: HTMLElement;
 readonly context: MarkdownPostProcessorContext;
 readonly sourcePath: string;
 readonly items: Set<InlineOccurrence>;
 subscription: SurfaceSubscription;
}

const sectionKey = (section: MarkdownSectionInformation | null) => JSON.stringify(section);
const codeNodes = (root: HTMLElement) => [...(root.matches('code') ? [root] : []),
 ...Array.from(root.querySelectorAll<HTMLElement>('code'))].filter(code => !code.closest('pre'));

/** A physical section is observed in full, even when the callback covers one subtree. */
function sectionRoot(code: HTMLElement, callback: HTMLElement, context: MarkdownPostProcessorContext): HTMLElement {
 const footnote = code.closest<HTMLElement>('section.footnotes > ol > li');
 if (footnote) return footnote;
 const key = sectionKey(context.getSectionInfo(code));
 let root = callback.matches('code') ? callback.parentElement ?? callback : callback;
 const boundary = observedContextContainer(context);
 // Detached callback roots can be assembled before insertion. Connected contexts
 // supply the limit; without one, only the supplied subtree/parent is evidence.
 if (!root.isConnected || boundary?.contains(root)) {
  while (root.parentElement && root.parentElement !== boundary &&
   sectionKey(context.getSectionInfo(root.parentElement)) === key) root = root.parentElement;
 }
 return root;
}

/** Own original code DOM and project exact indexed occurrences from the target's complete note. */
export function createInlineNumeralsPostProcessor(registry: SourceRegistry, getSettings: () => NumeralsSettings): InlinePostProcessor {
 const occurrences = new WeakMap<HTMLElement, InlineOccurrence>();
 const contexts = new WeakMap<MarkdownPostProcessorContext, Map<HTMLElement, ReadingSection>>();
 const active = new Set<ReadingSection>();
 let disposed = false;
 const processor = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
  if (disposed) return;
  let sections = contexts.get(ctx);
  if (!sections) { sections = new Map(); contexts.set(ctx, sections); }
  const refresh = new Set<ReadingSection>();
  const candidates = new Set(codeNodes(el));
  for (const code of candidates) {
   const root = sectionRoot(code, el, ctx);
   let group = sections.get(root);
   if (group && group.sourcePath !== ctx.sourcePath) {
    for (const item of [...group.items]) {
     if (root.contains(item.code)) candidates.add(item.code);
     item.dispose();
    }
    group = undefined;
   }
   if (!group) {
    const items = new Set<InlineOccurrence>();
    const subscription = new SurfaceSubscription(registry, root, ctx, (source, current, signal) => {
     for (const item of items) { item.reconcileSource(); item.restore(); }
     const settings = current?.settings ?? getSettings();
     if (!settings.enableInlineNumerals) return;
     const snapshot = current?.state.status === 'ready' ? current.state.snapshot : undefined;
     const runtime = source && snapshot && registry.coordinator.renderContext(source.identity, snapshot);
     const physical = new Map<string, {section: MarkdownSectionInformation | null; codes: HTMLElement[]}>();
     for (const node of codeNodes(root)) {
      const section = ctx.getSectionInfo(node), key = sectionKey(section);
      if (!physical.has(key)) physical.set(key, {section, codes: []});
      physical.get(key)!.codes.push(node);
     }
     for (const observed of physical.values()) {
      const sources = observed.codes.map(node => occurrences.get(node)?.source ?? node.innerText ?? node.textContent ?? '');
      const bindings = current && bindReadingCodes(current.index, observed.section, sources,
       root.matches('section.footnotes > ol > li') ? {lineDelta: root.getAttribute('data-line'),
        bodyId: root.getAttribute('data-footnote-id'), docId: ctx.docId} : undefined);
      for (const [ordinal, code] of observed.codes.entries()) {
       const item = occurrences.get(code);
       if (!item || !items.has(item)) continue;
       const parsed = parseInlineExpression(item.source, getInlineTriggers(settings));
       if (!parsed) continue;
       // A proved non-calculation is ordinary or raw HTML code. An unproved
       // occurrence retains its original DOM and gets a local, honest limitation.
       if (!bindings) {
        item.showLimitation(source?.diagnostic ?? (!current ? 'Updating calculation…' :
         'Calculation source identity is incomplete or ambiguous in this rendered section.'));
        continue;
       }
       const indexed = bindings[ordinal];
       if (!indexed) continue;
       const result = snapshot?.calculations.find(calculation => calculation.calculationId === indexed.id);
       let error = result?.diagnostic?.message ?? (current?.state.status === 'pending' ? 'Updating calculation…' :
        current?.state.status === 'error' ? current.state.message : !result ? snapshot?.diagnostics[0]?.message ?? 'Calculation is unavailable.' : undefined);
       let formatted = {text: '', tex: '', canonical: ''}, inputTeX: string | undefined;
       if (result && snapshot && runtime && !error) {
        const output = snapshot.format(result.calculationId, 0);
        if ('diagnostic' in output) error = output.diagnostic.message;
        else formatted = output.value;
        if (parsed.mode === InlineNumeralsMode.Equation) {
         try { inputTeX = inputPresentation(result.rows[0]?.processedInput ?? '', parsed.expression, parsed.renderStyle, runtime.engine).inputTeX; }
         catch (failure: unknown) { error = failure instanceof Error ? failure.message : String(failure); }
        }
       }
       renderInlinePresentation(item.code, {rawExpression: parsed.expression, mode: parsed.mode,
        renderStyle: parsed.renderStyle, formattedResult: formatted, inputTeX, error, separator: settings.inlineEquationSeparator}, signal);
       item.markRendered();
      }
     }
    }, message => { for (const item of items) { item.restore(); item.showLimitation(message); } });
    group = {root, context: ctx, sourcePath: ctx.sourcePath, items, subscription}; sections.set(root, group); active.add(group);
   }
   const existing = occurrences.get(code);
   if (existing && group.items.has(existing) && existing.ownershipPath === ctx.sourcePath) {
    existing.reconcileSource(); refresh.add(group); continue;
   }
   existing?.dispose();
   const owned = group;
   const occurrence = new InlineOccurrence(code, ctx, () => owned.subscription.refresh(), () => {
    owned.items.delete(occurrence);
    if (occurrences.get(code) === occurrence) occurrences.delete(code);
    if (!owned.items.size) {
     owned.subscription.dispose(); active.delete(owned);
     if (sections?.get(root) === owned) sections.delete(root);
    }
   });
   occurrences.set(code, occurrence); group.items.add(occurrence); ctx.addChild(occurrence); refresh.add(group);
  }
  for (const group of refresh) group.subscription.refresh();
 };
 processor.dispose = () => {
  if (disposed) return;
  disposed = true;
  for (const group of [...active]) for (const item of [...group.items]) item.dispose();
 };
 return processor;
}
