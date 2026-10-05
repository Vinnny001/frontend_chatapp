// @mentions are stored in message text as "@[label](userId)" (label = @username or number),
// and shown with the name each reader knows that person by.
export const MENTION_TOKEN = /@\[([^\]\n]{1,80})\]\(([a-f0-9]{24})\)/g;

/** The public label baked into a token (never someone's private name). */
export const mentionLabel = (p) => (p.username || p.phone || p.name || 'someone').replace(/[\]\n]/g, '');

export const mentionToken = (p) => `@[${mentionLabel(p)}](${p.id})`;

/** "@Name", without doubling the @ of names that are already "@username". */
export const atName = (name) => (name.startsWith('@') ? name : `@${name}`);

/** How a mentioned person is shown to me: "@You", my name for them, or the label. */
export function mentionName(conv, id, label, me) {
  if (id === me) return '@You';
  return atName(conv?.participants.find((p) => p.id === id)?.name || label);
}

/** Text with tokens replaced by "@Name" (previews, copy, notifications). */
export const plainMentions = (text, conv, me) =>
  (text || '').replace(MENTION_TOKEN, (_, label, id) => mentionName(conv, id, label, me));

/** Strings and { mention: { id, label } } pieces, in order. */
export function splitMentions(text) {
  const parts = [];
  let last = 0;
  for (const m of (text || '').matchAll(MENTION_TOKEN)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ mention: { label: m[1], id: m[2] } });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) parts.push(text.slice(last));
  return parts;
}
