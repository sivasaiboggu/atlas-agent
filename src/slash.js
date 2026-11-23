// Atlas — slash commands in the composer.
// Typing "/" opens a menu; picking a command pre-fills the composer
// with the right request. Nothing runs until the user sends it.

export const SLASH_COMMANDS = [
  { name: 'search', hint: 'query', description: 'Search the web', action: 'fill', build: (arg) => `Search the web for ${arg}` },
  { name: 'mail', hint: 'address', description: 'Draft a mail', action: 'fill', build: (arg) => `Draft a mail to ${arg}` },
  { name: 'task', hint: 'title', description: 'Add a task', action: 'fill', build: (arg) => `Add a task: ${arg}` },
  { name: 'note', hint: 'title', description: 'Save a note', action: 'fill', build: (arg) => `Save a note titled "${arg}"` },
  { name: 'weather', hint: 'place', description: 'Weather for a place', action: 'fill', build: (arg) => `What's the weather in ${arg}` },
  { name: 'calc', hint: 'expression', description: 'Work out a sum', action: 'fill', build: (arg) => `Calculate ${arg}` },
  { name: 'file', hint: '', description: 'Summarise the attached file', action: 'file', build: () => 'Summarise the attached file' },
];

// Parse "/search cats" -> { name: 'search', arg: 'cats', command }.
// Returns null when the text does not start with "/".
export function parseSlash(text) {
  if (!String(text || '').startsWith('/')) return null;
  const rest = String(text).slice(1);
  const space = rest.search(/\s/);
  const name = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const arg = space === -1 ? '' : rest.slice(space + 1).trim();
  const command = SLASH_COMMANDS.find((c) => c.name === name) || null;
  return { name, arg, command };
}

// Commands whose name starts with the typed prefix (for the menu).
export function matchSlashCommands(prefix) {
  const p = String(prefix || '').toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(p));
}
