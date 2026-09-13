import { type LineRenderData, type RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';
import { htmlToElements } from '../rendering/displayUtils';

export class SyntaxHighlightRenderer extends BaseLineRenderer {
 renderLine(container: HTMLElement, line: LineRenderData, context: RenderContext): void {
  const {inputElement, resultElement} = this.createElements(container);
  if (line.isEmpty) {
   inputElement.setText(line.rawInput + (line.comment ?? ''));
   this.handleEmptyLine(inputElement, resultElement);
  } else {
   inputElement.appendChild(htmlToElements(line.inputHTML ?? ''));
   this.renderFormattedResult(resultElement, line, context);
   if (line.comment) this.renderInlineComment(inputElement, line.comment);
  }
 }
}
