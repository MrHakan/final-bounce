// Breakable blocks.
//  - colour barriers break only for the contestant of the same colour
//  - grey (neutral) barriers take damage from anyone and break at 0 HP
// When a colour's contestant is eliminated its barriers turn into grey 1-HP
// blocks, so a dead colour can never softlock the course.
// Ids are assigned by the level generator in creation order (deterministic).
export function makeBarrier(x, y, w, h, color, hp = 1, role = 'gate') {
  return { kind: 'barrier', id: -1, x, y, w, h, color, hp, maxHp: hp, role };
}

export function barrierMatches(barrier, contestant) {
  return barrier.color !== null && barrier.color === contestant.id;
}
