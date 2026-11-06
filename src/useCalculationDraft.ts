import { useCallback, useRef, useState } from 'react';
import { emptyDraft, readDraft, removeStored, saveDraft } from './calculationDraft';
import type { CalculationDraft } from './calculationDraft';

// Saves only explicit changes, never mount/unmount or a render/effect's empty state.
// Owners are keyed by scope; async restoration must check its abort signal first.
export function useCalculationDraft(key?: string) {
  const [initial] = useState(() => readDraft(key));
  const [value, setValue] = useState(initial.value ?? emptyDraft);
  const current = useRef(value);
  const [message, setMessage] = useState(initial.error ?? (initial.value ? 'Draft restored on this device.' : ''));
  const update = useCallback((change: Partial<CalculationDraft> | ((previous: CalculationDraft) => CalculationDraft)) => {
    const next = typeof change === 'function' ? change(current.current) : { ...current.current, ...change };
    current.current = next;
    setValue(next);
    setMessage(!key ? '' : saveDraft(key, next) ? 'Draft saved on this device.' : 'Draft could not be saved on this device. Changes are session-only.');
  }, [key]);
  const restore = useCallback((next: CalculationDraft) => {
    const changed = JSON.stringify(next) !== JSON.stringify(current.current);
    current.current = next; setValue(next);
    // Persist only a verified reconciliation that actually changed a valid draft.
    // This prevents excluded references returning if the roster changes again.
    if (changed && key && !saveDraft(key, next)) setMessage('Recovered changes could not be saved on this device. Changes are session-only.');
  }, [key]);
  const clear = useCallback((next = emptyDraft()) => {
    current.current = next; setValue(next);
    setMessage(!key ? '' : removeStored(key) ? 'Draft discarded on this device.' : 'Draft could not be removed from browser storage. Clear site data before leaving this device.');
  }, [key]);
  return { value, current, update, restore, clear, message, restored: !!initial.value };
}
