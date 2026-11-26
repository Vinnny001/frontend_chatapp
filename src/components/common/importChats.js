import { importChats } from '../../lib/exportChats.js';
import { toast } from '../../store/ui.js';

/**
 * "Import chats": the user picks a ChatApp export file (.json) from the phone / computer;
 * its messages become readable on this device again.
 */
export function pickAndImportChats() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.style.display = 'none';
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    toast('Importing chats…');
    try {
      const { chats, restored, readable } = await importChats(file);
      toast(
        restored
          ? `Imported ${restored} ${restored === 1 ? 'message' : 'messages'} from ${chats} ${chats === 1 ? 'chat' : 'chats'}`
          : readable
            ? 'All messages in this file can already be read on this device'
            : 'There were no messages to import in this file'
      );
    } catch (e) {
      toast(e.message || 'Couldn’t import this file', 'error');
    }
  };
  document.body.appendChild(input);
  input.click();
}
