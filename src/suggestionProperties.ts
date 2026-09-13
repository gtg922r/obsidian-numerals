import type { App, TFile } from 'obsidian';
import { getDataviewApi } from './dataview';
import { filterAvailableProperties } from './processing/crossNoteResolver';
import { removeCanonicalizedDuplicates } from './processing/scope';

/** Copy only declarative opt-in controls; never coerce a provider object or run
 * its iterator/accessors. Invalid controls conservatively opt ordinary fields out. */
function selection(value: unknown): unknown {
 if (value === undefined || typeof value === 'string') return value;
 if (!Array.isArray(value)) return 'none';
 const copied: string[] = [];
 for (const key of Object.getOwnPropertyNames(value)) {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) continue;
  const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
  if (!('value' in descriptor)) return 'none';
  const entry: unknown = descriptor.value;
  if (entry !== null && !['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof entry)) return 'none';
  copied.push(String(entry));
 }
 return copied;
}

/** Dummy values let existing opt-in/canonical-name helpers operate on keys only. */
function namesOnly(value: unknown): Record<string, unknown> {
 const names: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
 if (!value || typeof value !== 'object') return names;
 for (const key of Object.getOwnPropertyNames(value)) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
  if (!descriptor.enumerable) continue;
  if (key === 'numerals') names[key] = 'value' in descriptor ? selection(descriptor.value) : 'none';
  else if ('value' in descriptor) names[key] = true;
 }
 return names;
}

/** Metadata expressions/values remain opaque during suggestion discovery. */
export function referencePropertyNames(app: App, file: TFile, forceAll: boolean): string[] {
 const cache = app.metadataCache.getFileCache(file);
 const frontmatter = cache && Object.getOwnPropertyDescriptor(cache, 'frontmatter');
 const native = namesOnly(frontmatter && 'value' in frontmatter ? frontmatter.value : undefined);
 const page = namesOnly(getDataviewApi(app)?.page(file.path));
 delete native.position; delete page.position; delete page.file;
 const metadata = {...native, ...removeCanonicalizedDuplicates(page)};
 return Object.keys(filterAvailableProperties(metadata, forceAll));
}
