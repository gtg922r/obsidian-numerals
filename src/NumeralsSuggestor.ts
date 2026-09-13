import type NumeralsPlugin from './main';
import { referencePropertyNames } from './suggestionProperties';
import { EditorSuggest, type EditorPosition, type Editor, type TFile, type EditorSuggestTriggerInfo,
 type EditorSuggestContext, setIcon } from 'obsidian';
import { getMathJsSymbols } from './mathjsUtilities';
import { findSuggestionContext } from './evaluation/sourceIndex';
import type { SourceProjection } from './evaluation/sourceProjection';
import type { SourceSnapshotState } from './host/snapshotCoordinator';
import { scanExpression } from './processing/expressionScanner';

const greekSymbols = [
    { trigger: 'alpha', symbol: 'α' },
    { trigger: 'beta', symbol: 'β' },
    { trigger: 'gamma', symbol: 'γ' },
    { trigger: 'delta', symbol: 'δ' },
    { trigger: 'epsilon', symbol: 'ε' },
    { trigger: 'zeta', symbol: 'ζ' },
    { trigger: 'eta', symbol: 'η' },
    { trigger: 'theta', symbol: 'θ' },
    { trigger: 'iota', symbol: 'ι' },
    { trigger: 'kappa', symbol: 'κ' },
    { trigger: 'lambda', symbol: 'λ' },
    { trigger: 'mu', symbol: 'μ' },
    { trigger: 'nu', symbol: 'ν' },
    { trigger: 'xi', symbol: 'ξ' },
    { trigger: 'omicron', symbol: 'ο' },
    { trigger: 'pi', symbol: 'π' },
    { trigger: 'rho', symbol: 'ρ' },
    { trigger: 'sigma', symbol: 'σ' },
    { trigger: 'tau', symbol: 'τ' },
    { trigger: 'upsilon', symbol: 'υ' },
    { trigger: 'phi', symbol: 'φ' },
    { trigger: 'chi', symbol: 'χ' },
    { trigger: 'psi', symbol: 'ψ' },
    { trigger: 'omega', symbol: 'ω' },
    { trigger: 'Gamma', symbol: 'Γ' },
    { trigger: 'Delta', symbol: 'Δ' },
    { trigger: 'Theta', symbol: 'Θ' },
    { trigger: 'Lambda', symbol: 'Λ' },
    { trigger: 'Xi', symbol: 'Ξ' },
    { trigger: 'Pi', symbol: 'Π' },
    { trigger: 'Sigma', symbol: 'Σ' },
    { trigger: 'Phi', symbol: 'Φ' },
    { trigger: 'Psi', symbol: 'Ψ' },
    { trigger: 'Omega', symbol: 'Ω' },
];

const numeralsDirectives = ['@hideRows', '@Sum', '@Total', '@Prev'];
const PROPERTY_NAME = /^[\w$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+$/;
const CROSS_NOTE_TRIGGER_REGEX = /\[\[([^\]\r\n]+)\]\]\.([\w$\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]*)$/;

type TriggerKind = 'block' | 'inline';
interface CompletionQuery {
 readonly editor: Editor;
 readonly file: TFile;
 readonly path: string;
 readonly current: SourceSnapshotState;
 readonly settingsGeneration: number;
 readonly kind: TriggerKind;
 readonly from: number;
 readonly to: number;
 readonly text: string;
 readonly noteName?: string;
}
interface ReferenceProperties { readonly file: TFile; readonly path: string; readonly names: readonly string[] }
export interface NumeralsSuggestion {
 readonly type: string;
 readonly text: string;
 readonly note?: string;
 readonly query: CompletionQuery;
 readonly reference?: ReferenceProperties;
}
const samePosition = (a: EditorPosition, b: EditorPosition) => a.line === b.line && a.ch === b.ch;

/** Suggestions consume copied snapshot descriptions; they never evaluate note or metadata expressions. */
export class NumeralsSuggestor extends EditorSuggest<NumeralsSuggestion> {
 private active?: CompletionQuery;
 private stopSource = () => {};
 private disposed = false;
 constructor(private readonly plugin: NumeralsPlugin) {
  super(plugin.app);
  const stopSettings = plugin.subscribeSettingsChanges(() => this.close());
  plugin.register(() => {this.disposed = true; this.close(); stopSettings();});
 }

 private enabled(kind: TriggerKind): boolean {
  const settings = this.plugin.settings;
  return kind === 'block' ? settings.provideSuggestions : settings.enableInlineNumerals && settings.provideInlineSuggestions;
 }
 private retire(): void { this.active = undefined; this.context = null; this.stopSource?.(); this.stopSource = () => {}; }
 close(): void { this.retire(); super.close(); }

 onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
  this.retire();
  if (this.disposed || !file || this.app.vault.getAbstractFileByPath(file.path) !== file) return null;
  const settings = this.plugin.settings;
  if (!settings.provideSuggestions && !(settings.enableInlineNumerals && settings.provideInlineSuggestions)) return null;
  const current = this.plugin.getEditorSnapshot(editor), offset = editor.posToOffset(cursor);
  if (!current || current.index.evaluationBlocked || current.index.source.path !== file.path ||
   current.index.source.text !== editor.getValue()) return null;
  const block = current.index.calculations.find(calculation => calculation.kind === 'block' &&
   offset >= calculation.opener.end && offset <= (calculation.closer?.start ?? calculation.span.end));
  let projection: SourceProjection, kind: TriggerKind;
  if (block) {kind = 'block'; projection = block.projection;}
  else {
   const inline = findSuggestionContext(current.index, offset);
   if (!inline) return null;
   kind = 'inline'; projection = inline.expression;
  }
  if (!this.enabled(kind)) return null;
  // Only a copied physical token is writable. An empty property name uses the
  // validated cursor point in the segment containing the preceding reference dot.
  const segment = projection.segments.find(segment => segment.kind === 'copy' &&
   segment.source.start <= offset && segment.source.end >= offset);
  if (!segment) return null;
  const to = segment.target.start + offset - segment.source.start;
  const prefix = projection.text.slice(0, to);
  const protectedToken = scanExpression(prefix).find(token =>
   (token.kind === 'string' || token.kind === 'comment') && token.start < to && token.end >= to);
  if (protectedToken) return null;
  const crossNote = prefix.match(CROSS_NOTE_TRIGGER_REGEX);
  if (crossNote && !settings.enableCrossNoteReferences) return null;
  const word = crossNote ? crossNote[2] : prefix.match(/[:]?[$@\w\u00C0-\u02AF\u0370-\u03FF\u2100-\u214F]+$/)?.[0];
  if (word === undefined || offset - word.length < segment.source.start) return null;
  const query: CompletionQuery = {editor, file, path: file.path, current, settingsGeneration: this.plugin.settingsGeneration,
   kind, from: offset - word.length, to: offset, text: word, noteName: crossNote ? crossNote[1] : undefined};
  this.active = query;
  const stop = this.plugin.subscribeEditorSnapshot(editor, () => {if (!this.valid(query)) this.close();});
  if (this.active === query) this.stopSource = stop;
  else stop();
  return this.active === query ? {start: editor.offsetToPos(query.from), end: {...cursor}, query: word} : null;
 }

 /** All returned items retain their original proposal, including reference lookups. */
 getSuggestions(context: EditorSuggestContext): NumeralsSuggestion[] {
  const query = this.active;
  if (!query || !this.matchesContext(query, context) || !this.valid(query)) return [];
  if (query.noteName !== undefined) return this.crossNoteSuggestions(query);
  const snapshot = query.current.state.status === 'ready' ? query.current.state.snapshot : undefined;
  const names = new Set<string>();
  if (snapshot) {
   // Ordinary seeds initialize every calculation, including unfinished inline
   // suggestion contexts. Dollar seeds must come from the latest checkpoint.
   if (!query.current.index.calculations.some(calculation => calculation.span.start <= query.from && query.from < calculation.span.end))
    for (const symbol of snapshot.metadataSymbols) if (symbol.origin === 'local') names.add(symbol.name);
   for (const symbol of snapshot.symbolsAt(query.from)) names.add(symbol.name);
  }
  const lower = query.text.toLowerCase();
  const matches = (text: string) => text.toLowerCase().startsWith(lower) && text.toLowerCase() !== lower;
  const suggestions: NumeralsSuggestion[] = [...names].filter(matches).sort((a, b) => a.localeCompare(b))
   .map(text => ({type: 'v', text, query}));
  if (this.plugin.settings.suggestionsIncludeMathjsSymbols) {
   for (const encoded of getMathJsSymbols()) {
    const [type, text] = encoded.split('|');
    if (matches(text)) suggestions.push({type, text, query});
   }
  }
  for (const text of query.kind === 'block' ? numeralsDirectives : ['@prev']) {
   if (matches(text)) suggestions.push({type: 'm', text, query});
  }
  if (this.plugin.settings.enableGreekAutoComplete) {
   for (const {trigger, symbol} of greekSymbols) if ((':' + trigger.toLowerCase()).startsWith(lower))
    suggestions.push({type: 'g', text: symbol, note: trigger, query});
  }
  return this.valid(query) ? suggestions : [];
 }

 private matchesContext(query: CompletionQuery, context: EditorSuggestContext): boolean {
  return context.editor === query.editor && context.file === query.file && context.query === query.text &&
   samePosition(context.start, query.editor.offsetToPos(query.from)) && samePosition(context.end, query.editor.offsetToPos(query.to));
 }
 private valid(query: CompletionQuery): boolean {
  if (this.disposed || this.active !== query || this.plugin.settingsGeneration !== query.settingsGeneration ||
   !this.enabled(query.kind) || (query.noteName !== undefined && !this.plugin.settings.enableCrossNoteReferences) || query.file.path !== query.path || this.app.vault.getAbstractFileByPath(query.path) !== query.file) return false;
  const current = this.plugin.getEditorSnapshot(query.editor), end = query.editor.offsetToPos(query.to);
  return current?.sourceId === query.current.sourceId && current.index === query.current.index && current.state === query.current.state &&
   current.index.source.path === query.path && current.index.source.text === query.editor.getValue() &&
   query.editor.getValue().slice(query.from, query.to) === query.text &&
   samePosition(query.editor.getCursor('from'), end) && samePosition(query.editor.getCursor('to'), end);
 }

 private properties(query: CompletionQuery): ReferenceProperties | undefined {
  if (!this.valid(query) || query.noteName === undefined) return;
  const file = this.app.metadataCache.getFirstLinkpathDest(query.noteName, query.path);
  if (!file || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
  const names = referencePropertyNames(this.app, file, this.plugin.settings.forceProcessAllFrontmatter);
  if (!this.valid(query)) return;
  return {file, path: file.path, names: names.filter(key => PROPERTY_NAME.test(key)).sort()};
 }
 private crossNoteSuggestions(query: CompletionQuery): NumeralsSuggestion[] {
  // Current-cache key discovery is synchronous. An artificial Promise would
  // let an obsolete host continuation replace or close a newer popup.
  const reference = this.properties(query);
  if (!reference || !this.valid(query) || !this.referenceCurrent(query, reference)) return [];
  const lower = query.text.toLowerCase();
  return reference.names.filter(key => key.toLowerCase().startsWith(lower) && key !== query.text)
   .map(text => ({type: 'n', text, query, reference}));
 }
 private referenceCurrent(query: CompletionQuery, reference: ReferenceProperties): boolean {
  const current = this.properties(query);
  return current?.file === reference.file && current.path === reference.path && current.names.length === reference.names.length &&
   current.names.every((name, index) => name === reference.names[index]);
 }

 renderSuggestion(value: NumeralsSuggestion, el: HTMLElement): void {
  el.addClasses(['mod-complex', 'numerals-suggestion']);
  const content = el.createDiv({cls: 'suggestion-content'});
  content.createDiv({cls: 'suggestion-title', text: value.text});
  if (value.note) content.createDiv({cls: 'suggestion-note', text: value.note});
  const flair = el.createDiv({cls: 'suggestion-aux'}).createDiv({cls: 'suggestion-flair'});
  const icons: Record<string, string> = {f: 'function-square', c: 'locate-fixed', v: 'file-code', p: 'box',
   m: 'sparkles', g: 'case-lower', n: 'file-symlink'};
  if (icons[value.type]) setIcon(flair, icons[value.type]);
 }

 selectSuggestion(value: NumeralsSuggestion, _evt: MouseEvent | KeyboardEvent): void {
  const query = value.query;
  if (this.active !== query) return;
  if (!this.context || !this.matchesContext(query, this.context) || !this.valid(query) ||
   (value.reference && !this.referenceCurrent(query, value.reference))) {this.close(); return;}
  const start = query.editor.offsetToPos(query.from), end = query.editor.offsetToPos(query.to);
  // Retire our subscription before the edit publishes. Close the host popover
  // afterwards, so popover/focus callbacks cannot intervene before the write.
  this.retire();
  try {
   query.editor.replaceRange(value.text, start, end);
   query.editor.setCursor(query.editor.offsetToPos(query.from + value.text.length - (value.type === 'f' ? 1 : 0)));
  } finally {super.close();}
 }
}
