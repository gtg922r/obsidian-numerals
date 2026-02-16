import NumeralsPlugin from "./main";
import { getMetadataForFileAtPath, getScopeFromFrontmatter } from "./numeralsUtilities";
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

export class NumeralsSuggestor extends EditorSuggest<string> {
	plugin: NumeralsPlugin;
	
	/**
	 * Time of last suggestion list update
	 * @type {number}
	 * @private */
	private lastSuggestionListUpdate = 0;

	/**
	 * List of possible suggestions based on current code block
	 * @type {string[]}
	 * @private */
	private localSuggestionCache: string[] = [];

	//empty constructor
	constructor(plugin: NumeralsPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	private getMathBlockTextToCursor(
		editor: Editor,
		cursor: EditorPosition
	): string | null {
		const linesToCursor: string[] = [];

		for (let line = cursor.line; line >= 0; line--) {
			const fullLine = editor.getLine(line);
			const lineText = line === cursor.line ? fullLine.slice(0, cursor.ch) : fullLine;
			linesToCursor.unshift(lineText);

			const fenceMatch = fullLine.match(/^```([^\s]*)?/);
			if (!fenceMatch) {
				continue;
			}

			const fenceLanguage = (fenceMatch[1] ?? "").toLowerCase();
			if (fenceLanguage.startsWith("math")) {
				return linesToCursor.join("\n");
			}

			return null;
		}

		return null;
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
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.provideSuggestions) {
			return null;
		}

		const currentBlockToCursor = this.getMathBlockTextToCursor(editor, cursor);
		if (!currentBlockToCursor) {
			return null;
		}

		// Get last word in current line
		const currentLineToCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
		const currentLineLastWordStart = currentLineToCursor.search(/[:]?[$@\w\u0370-\u03FF]+$/);
		// if there is no word, return null
		if (currentLineLastWordStart === -1) {
			return null;
		}

		return {
			start: {line: cursor.line, ch: currentLineLastWordStart},
			end: cursor,
			query: currentLineToCursor.slice(currentLineLastWordStart)
		};
	}

	getSuggestions(context: EditorSuggestContext): string[] | Promise<string[]> {
		let localSymbols: string [] = [];	

		// check if the last suggestion list update was less than 200ms ago
		const shouldRefreshCache =
			this.localSuggestionCache.length === 0 ||
			performance.now() - this.lastSuggestionListUpdate > 200;
		if (shouldRefreshCache) {
			const currentBlockToCursor = this.getMathBlockTextToCursor(context.editor, context.start);
	
			if (currentBlockToCursor) {
				//technically there is a risk we aren't in a math block, but we shouldn't have been triggered if we weren't
				// Return all variable names in the last codeblock up to the cursor
				const matches = currentBlockToCursor.matchAll(/^\s*(\S*?)\s*=.*$/gm);
				// create array from first capture group of matches and remove duplicates
				localSymbols = [...new Set(Array.from(matches, (match) => 'v|' + match[1]))];
			}

			// combine frontmatter and dataview metadata, with dataview metadata taking precedence
			const metadata = getMetadataForFileAtPath(context.file.path, this.app, this.plugin.scopeCache);


			if (metadata) {
				const frontmatterSymbols = getScopeFromFrontmatter(metadata, undefined, this.plugin.settings.forceProcessAllFrontmatter, undefined, true);
				// add frontmatter symbols to local symbols
				const frontmatterSymbolsArray = Array.from(frontmatterSymbols.keys()).map(symbol => 'v|' + symbol);
				localSymbols = [...new Set([...localSymbols, ...frontmatterSymbolsArray])];
			}

			this.localSuggestionCache = localSymbols;
			this.lastSuggestionListUpdate = performance.now();
		} else {
			localSymbols = this.localSuggestionCache
		}

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

		suggestions = suggestions.concat(
			numeralsDirectives
				.filter((value) => value.slice(0,-1).toLowerCase().startsWith(query_lower, 0))
				.map((value) => 'm|' + value)
			);

		// TODO MOVE THESE UP INTO THE CACHED portion. also trigger isn't the right name
		if (this.plugin.settings.enableGreekAutoComplete) {
			const greek_suggestions = greekSymbols.filter(({ trigger }) => (":" + trigger.toLowerCase()).startsWith(query_lower)).map(({ symbol, trigger }) => 'g|' + symbol + '|' + trigger);
			suggestions = suggestions.concat(greek_suggestions);
		}

		return suggestions;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		
		el.addClasses(['mod-complex', 'numerals-suggestion']);
		const suggestionContent = el.createDiv({cls: 'suggestion-content'});
		const suggestionTitle = suggestionContent.createDiv({cls: 'suggestion-title'});
		const suggestionNote = suggestionContent.createDiv({cls: 'suggestion-note'});
		const suggestionAux = el.createDiv({cls: 'suggestion-aux'});
		const suggestionFlair = suggestionAux.createDiv({cls: 'suggestion-flair'});

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
			setIcon(suggestionFlair, 'case-lower'); // Assuming 'symbol' is a valid icon name
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
