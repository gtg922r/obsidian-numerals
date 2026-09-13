import { type LineRenderData, type RenderContext } from '../numerals.types';
import { BaseLineRenderer } from './BaseLineRenderer';
import { renderOwnedMath } from '../rendering/mathLifecycle';

export class TeXRenderer extends BaseLineRenderer {
 renderLine(container: HTMLElement, line: LineRenderData, context: RenderContext): void {
  const {inputElement, resultElement} = this.createElements(container);
  if (line.isEmpty) {
   inputElement.setText(line.rawInput + (line.comment ?? ''));
   this.handleEmptyLine(inputElement, resultElement);
  } else {
   renderOwnedMath(inputElement.createSpan({cls: 'numerals-tex'}), line.inputTeX ?? '', context.signal);
   renderOwnedMath(resultElement.createSpan({cls: 'numerals-tex'}), line.formattedResult?.tex ?? '', context.signal);
   if (line.comment) this.renderInlineComment(inputElement, line.comment);
  }
 }
}
