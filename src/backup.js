// Atlas — back up and restore.
// Export downloads every local thing Atlas keeps (chats, tasks, notes,
// reminders, plans, model + theme) as one JSON file. The API key is
// never included — a backup must be safe to keep anywhere. Import
// validates the file before touching anything; a bad file changes
// nothing.

export const BACKUP_APP = 'atlas-agent';
export const BACKUP_VERSION = 1;

export function buildBackup({ state, tasks, notes, reminders, plans }) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state: {
      settings: {
        model: state?.settings?.model || 'gemini-2.5-flash',
        theme: state?.settings?.theme || 'dark',
      },
      conversations: Array.isArray(state?.conversations) ? state.conversations : [],
      activeId: state?.activeId || null,
    },
    tasks: Array.isArray(tasks) ? tasks : [],
    notes: Array.isArray(notes) ? notes : [],
    reminders: Array.isArray(reminders) ? reminders : [],
    plans: Array.isArray(plans) ? plans : [],
  };
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'That file is not a backup.' };
  }
  if (data.app !== BACKUP_APP) {
    return { ok: false, error: 'That file is not an Atlas backup.' };
  }
  if (data.version !== BACKUP_VERSION) {
    return { ok: false, error: 'That backup is from a different version of Atlas.' };
  }
  if (!data.state || !Array.isArray(data.state.conversations)) {
    return { ok: false, error: 'The backup is missing its chats.' };
  }
  for (const key of ['tasks', 'notes', 'reminders', 'plans']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      return { ok: false, error: `The backup has a bad ${key} section.` };
    }
  }
  return { ok: true };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch (err) {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  const check = validateBackup(data);
  if (!check.ok) return check;
  return { ok: true, data };
}
