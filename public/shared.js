// Small helpers used by the game, the lesson and the home screen board.

export const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Classes that draw a bridge to the right or lower neighbour when both squares share an owner.
// `owners` is a flat board list, and `isOwner` says whether a value is a real owner.
export function linkClasses(owners, index, cols, isOwner) {
  const owner = owners[index];
  if (!isOwner(owner)) return [];
  const classes = [];
  if ((index + 1) % cols !== 0 && owners[index + 1] === owner) classes.push('link-r');
  if (owners[index + cols] === owner) classes.push('link-d');
  return classes;
}
