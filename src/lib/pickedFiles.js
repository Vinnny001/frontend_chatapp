// Files picked from the gallery / file manager. On phones a picked file is only a reference to
// the other app's copy, readable for a short time; reading it later (when it's sent, or after the
// app was in the background) fails with "The requested file could not be read…". So each file is
// copied into ChatApp's memory the moment it's picked, while it can still be read.

export const MAX_PICK = 30; // files sent at once
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * → { files: [File] (readable copies), skipped: [{ name, reason }] }.
 * Too-big files are skipped up front (their content isn't read at all).
 */
export async function copyPicked(list) {
  const files = [];
  const skipped = [];
  for (const f of [...(list || [])].slice(0, MAX_PICK)) {
    if (f.size > MAX_BYTES) {
      skipped.push({ name: f.name, reason: 'is larger than 50 MB' });
      continue;
    }
    try {
      const data = await f.arrayBuffer();
      files.push(new File([data], f.name || 'file', { type: f.type || '', lastModified: f.lastModified || Date.now() }));
    } catch {
      skipped.push({ name: f.name || 'A file', reason: 'couldn’t be read. Pick it again (or from Files instead of Photos).' });
    }
  }
  if ((list?.length || 0) > MAX_PICK) skipped.push({ name: `${list.length - MAX_PICK} more`, reason: `weren’t added (up to ${MAX_PICK} at once)` });
  return { files, skipped };
}

/** One line for a toast about the files that couldn't be added ('' if none). */
export const skippedText = (skipped) =>
  !skipped.length ? '' : skipped.length === 1 ? `${skipped[0].name} ${skipped[0].reason}` : `${skipped.length} files couldn’t be added: ${skipped[0].name} ${skipped[0].reason}`;
