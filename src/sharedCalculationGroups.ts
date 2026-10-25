import type { CalculationParticipant } from './sharedCalculationData';

const compareText = (a: string, b: string) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0);
type GroupParticipant = Pick<CalculationParticipant, 'id' | 'name' | 'jobTitle' | 'isTemporary' | 'roleId'>;
const comparePeople = (a: GroupParticipant, b: GroupParticipant) => compareText(a.name, b.name) || compareText(a.id, b.id);

// Presentation only: never mutate the authorized snapshot or financial inputs.
// Permanent rows carry their already-authorized role ID; temporary role labels
// never determine group identity. Keep the temporary section last, even if empty.
export function groupCalculationParticipants<T extends GroupParticipant>(participants: readonly T[]) {
  const roles = new Map<string, { id: string; name: string; isTemporary: boolean; participants: T[] }>();
  const temporary = { id: 'temporary', name: 'Temporary participants', isTemporary: true, participants: [] as T[] };
  for (const participant of participants) {
    if (participant.isTemporary) {
      temporary.participants.push(participant);
      continue;
    }
    const id = `role:${participant.roleId ?? participant.jobTitle}`;
    let group = roles.get(id);
    if (!group) {
      group = { id, name: participant.jobTitle, isTemporary: false, participants: [] };
      roles.set(id, group);
    }
    group.participants.push(participant);
  }
  const groups = [...roles.values()].sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
  groups.push(temporary);
  for (const group of groups) group.participants.sort(comparePeople);
  return groups;
}
