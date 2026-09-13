import NumeralsPlugin from "./main";
import { getMetadataForReferencedNote, filterAvailableProperties } from "./processing/crossNoteResolver";
import {
    EditorSuggest,
    EditorPosition,
    Editor,
    TFile,
    EditorSuggestTriggerInfo,
    EditorSuggestContext,
    setIcon,
 } from "obsidian";
import { getMathJsSymbols } from "./mathjsUtilities";
import { findSuggestionContext } from "./evaluation/sourceIndex";
import type { SourceProjection } from "./evaluation/sourceProjection";

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

const numeralsDirectives = [
	"@hideRows",
	"@Sum",
	"@Total",
	"@Prev",
]

/** Whether the suggestor was triggered from a math code block or an inline code span. */
type SuggestorTriggerContext = 'block' | 'inline';

/**
 * Regex to detect [[note]]. followed by a partial property name at end of string.
 * Captures: [1] = note name, [2] = partial property (may be empty)
 */
const CROSS_NOTE_TRIGGER_REGEX = /\[\[([^\]]+)\]\]\.([\w$\u00C0-\u02AF\u0370-\u03FF]*)$/;

export class NumeralsSuggestor extends EditorSuggest<string> {
	plugin: NumeralsPlugin;

	/**
	 * Tracks whether the current trigger came from a math code block or
	 * an inline Numerals code span. Set in `onTrigger`, read in `getSuggestions`.
	 */
	private triggerContext: SuggestorTriggerContext = 'block';

	/**
	 * When non-null, the user is typing a property name after `[[noteName]].`
	 * and we should suggest properties from the referenced note.
	 */
	private crossNoteContext: { noteName: string } | null = null;
	
	//empty constructor
	constructor(plugin: NumeralsPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	/**
	 * This function is triggered when the user starts typing in the editor. It checks if the user is in a math block and if there is a word in the current line.
	 * If these conditions are met, it returns an object with the start and end positions of the word and the word itself as the query.
	 * If not, it returns null.
	 *
	 * @param cursor - The current position of the cursor in the editor.
	 * @param editor - The current editor instance.
	 * @param file - The current file being edited.
	 * @returns An object with the start and end positions of the word and the word itself as the query, or null if the conditions are not met.
	 */
 onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
  this.crossNoteContext = null;
  if (!this.plugin.settings.provideSuggestions) return null;
  const current = this.plugin.getEditorSnapshot(editor);
  const offset = editor.posToOffset(cursor);
  if (!current || current.index.source.path !== file.path || current.index.source.text !== editor.getValue()) return null;
  const block = current.index.calculations.find(calculation => calculation.kind === 'block' &&
   offset >= calculation.opener.end && offset <= (calculation.closer?.start ?? calculation.span.end));
  let projection: SourceProjection | undefined;
  if (block) { this.triggerContext = 'block'; projection = block.projection; }
  else {
   if (!this.plugin.settings.enableInlineNumerals || !this.plugin.settings.provideInlineSuggestions) return null;
   const inline = findSuggestionContext(current.index, offset);
   if (!inline) return null;
   this.triggerContext = 'inline'; projection = inline.expression;
  }
  // A replacement token must be an unchanged single physical span. Empty property
  // queries use the validated cursor point, not contiguousSourceSpan(empty).
  const segment = projection.segments.find(segment => segment.kind === 'copy' &&
   segment.source.start <= offset && segment.source.end >= offset);
  if (!segment) return null;
  const to = segment.target.start + offset - segment.source.start;
  const prefix = projection.text.slice(0, to);
  const crossNote = this.plugin.settings.enableCrossNoteReferences && prefix.match(CROSS_NOTE_TRIGGER_REGEX);
  const word = crossNote ? crossNote[2] : prefix.match(/[:]?[$@\w\u0370-\u03FF]+$/)?.[0];
  if (word === undefined || offset - word.length < segment.source.start) return null;
  if (crossNote) this.crossNoteContext = {noteName: crossNote[1]};
  return {start: editor.offsetToPos(offset - word.length), end: cursor, query: word};
 }

	getSuggestions(context: EditorSuggestContext): string[] | Promise<string[]> {
		// Cross-note reference suggestions: suggest properties from the referenced note
		if (this.crossNoteContext) {
			return this.getCrossNoteSuggestions(context, this.crossNoteContext.noteName);
		}

  const current = this.plugin.getEditorSnapshot(context.editor);
  const snapshot = current?.state.status === 'ready' && current.index.source.text === context.editor.getValue()
   ? current.state.snapshot : undefined;
  const names = new Set<string>();
  if (snapshot) {
   for (const symbol of snapshot.metadataSymbols) names.add(symbol.name);
   for (const symbol of snapshot.symbolsAt(context.editor.posToOffset(context.start))) names.add(symbol.name);
  }
  const localSymbols = [...names].map(name => 'v|' + name);

		const query_lower = context.query.toLowerCase();

		// case-insensitive filter local suggestions based on query. Don't return value if full match
		const local_suggestions = localSymbols.filter((value) => value.slice(0, -1).toLowerCase().startsWith(query_lower, 2));
		local_suggestions.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
		
		// case-insensitive filter mathjs suggestions based on query. Don't return value if full match
		let suggestions: string[] = [];
		if (this.plugin.settings.suggestionsIncludeMathjsSymbols) {
			const mathjs_suggestions = getMathJsSymbols().filter((value) => value.slice(0, -1).toLowerCase().startsWith(query_lower, 2));
			suggestions = local_suggestions.concat(mathjs_suggestions);
		} else { 
			suggestions = local_suggestions;
		}

		// Directives only apply in block context (they don't work in inline expressions)
		if (this.triggerContext === 'block') {
			suggestions = suggestions.concat(
				numeralsDirectives
					.filter((value) => value.slice(0,-1).toLowerCase().startsWith(query_lower, 0))
					.map((value) => 'm|' + value)
				);
		}

		// TODO MOVE THESE UP INTO THE CACHED portion. also trigger isn't the right name
		if (this.plugin.settings.enableGreekAutoComplete) {
			const greek_suggestions = greekSymbols.filter(({ trigger }) => (":" + trigger.toLowerCase()).startsWith(query_lower)).map(({ symbol, trigger }) => 'g|' + symbol + '|' + trigger);
			suggestions = suggestions.concat(greek_suggestions);
		}

		return suggestions;
	}

	/**
	 * Get property suggestions for a cross-note reference.
	 * Resolves the note, gets its available properties, and returns them as suggestions.
	 */
	private getCrossNoteSuggestions(
		context: EditorSuggestContext,
		noteName: string
	): string[] {
		const file = this.app.metadataCache.getFirstLinkpathDest(
			noteName,
			context.file.path
		);
		if (!file) return [];

		const metadata = getMetadataForReferencedNote(file, this.app);
		if (!metadata) return [];

		const available = filterAvailableProperties(
			metadata,
			this.plugin.settings.forceProcessAllFrontmatter
		);

		const query_lower = context.query.toLowerCase();

		// Build suggestions from available properties
		const suggestions: string[] = [];
		for (const key of Object.keys(available)) {
			if (key === 'position') continue; // internal Obsidian field
			if (key.toLowerCase().startsWith(query_lower) && key !== context.query) {
				// Use 'n|' prefix for note-reference properties
				suggestions.push('n|' + key);
			}
		}

		suggestions.sort((a, b) => a.slice(2).localeCompare(b.slice(2)));
		return suggestions;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		
		el.addClasses(['mod-complex', 'numerals-suggestion']);
		const suggestionContent = el.createDiv({cls: 'suggestion-content'});
		const suggestionTitle = suggestionContent.createDiv({cls: 'suggestion-title'});
		const suggestionNote = suggestionContent.createDiv({cls: 'suggestion-note'});
		const suggestionAux = el.createDiv({cls: 'suggestion-aux'});
		const suggestionFlair = suggestionAux.createDiv({cls: 'suggestion-flair'});

		const [iconType, suggestionText, noteText] = value.split('|');

		if (iconType === 'f') {
			setIcon(suggestionFlair, 'function-square');		
		} else if (iconType === 'c') {
			setIcon(suggestionFlair, 'locate-fixed');
		} else if (iconType === 'v') {
			setIcon(suggestionFlair, 'file-code');
		} else if (iconType === 'p') {
			setIcon(suggestionFlair, 'box');
		} else if (iconType === 'm') {
			setIcon(suggestionFlair, 'sparkles');			
		} else if (iconType === 'g') {
			setIcon(suggestionFlair, 'case-lower');
		} else if (iconType === 'n') {
			setIcon(suggestionFlair, 'file-symlink');
		}
		suggestionTitle.setText(suggestionText);
		if (noteText) {
			suggestionNote.setText(noteText);
		}

	}

	/**
	 * Called when a suggestion is selected. Replaces the current word with the selected suggestion
	 * @param value The selected suggestion
	 * @param evt The event that triggered the selection
	 * @returns void
	 */
	selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
		if (this.context) {
			const editor = this.context.editor;
			const [suggestionType, suggestion] = value.split('|');
			const start = this.context.start;
			const end = editor.getCursor(); // get new end position in case cursor has moved
			
			editor.replaceRange(suggestion, start, end);
			const newCursor = end;

			if (suggestionType === 'f') {
				newCursor.ch = start.ch + suggestion.length-1;
			} else {
				newCursor.ch = start.ch + suggestion.length;
			}
			editor.setCursor(newCursor);			

			this.close()
		}
	}
}
