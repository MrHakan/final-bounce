// Which gameplay event makes which sound. Shared by the live AudioEngine (plays
// immediately) and the video exporter (records the sound at the frame's time).
const PITCH = { red: 0, blue: 3, yellow: 7, green: 10 };

// play(name, params, throttleKey); returns a function that removes the listeners.
export function bindSoundEvents(bus, play) {
  const p = (id) => PITCH[id] || 0;
  const off = [
    bus.on('contestant:bounce', (e) => play('bounce', { pitch: p(e.actor), barrier: e.on === 'barrier' }, 'bounce:' + e.actor)),
    bus.on('contestant:bumper', (e) => play('bumper', { pitch: p(e.actor) }, 'bumper:' + e.actor)),
    bus.on('contestant:collision', () => play('collision', {}, 'collision')),
    bus.on('barrier:damage', () => play('greyHit', {}, 'greyHit')),
    bus.on('barrier:destroy', (e) => play(e.type === 'finalBreak' ? 'greyBreak' : 'colorBreak', { pitch: p(e.actor) }, e.type === 'finalBreak' ? 'greyBreak' : 'colorBreak')),
    bus.on('weapon:pickup', () => play('pickup', {}, 'pickup')),
    bus.on('weapon:break', () => play('shatter', {}, 'shatter')),
    bus.on('contestant:killed', (e) => play(e.cause === 'kill' ? 'kill' : 'purpleDeath', {}, e.cause === 'kill' ? 'kill' : 'purpleDeath')),
    bus.on('danger:nearMiss', () => play('nearMiss', {}, 'nearMiss')),
    bus.on('contestant:finish', (e) => play(e.place === 1 ? 'finish' : 'place', {}, e.place === 1 ? 'finish' : 'place')),
    bus.on('race:countdown', (e) => play(e.step === 3 ? 'go' : 'count', {}, e.step === 3 ? 'go' : 'count')),
    bus.on('race:intro', () => play('intro', {}, 'intro')),
  ];
  return () => off.forEach((f) => f());
}
