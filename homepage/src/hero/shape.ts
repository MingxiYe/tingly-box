// The hero grid is the letter T of the Tingly Box icon. `S` marks the cell the
// growth starts from; at every zoom level the previous, finished T sits there.
const T_SHAPE = [
  '#########',
  '#########',
  '####S####',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
];

export const N = T_SHAPE.length;
if (T_SHAPE.some((row) => row.length !== N)) throw new Error('T_SHAPE must be square');

export const cells: number[] = [];
export let START = -1;
const inShape = new Uint8Array(N * N);

T_SHAPE.forEach((row, y) => {
  [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const i = y * N + x;
    inShape[i] = 1;
    cells.push(i);
    if (ch === 'S') START = i;
  });
});

// Centre of the shape's bounding box; cell positions are measured from here.
export const CENTER = (N - 1) / 2;
export const col = (i: number): number => i % N;
export const row = (i: number): number => (i / N) | 0;

export const neighbours = new Map<number, number[]>();
for (const i of cells) {
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = col(i) + dx;
    const y = row(i) + dy;
    if (x >= 0 && y >= 0 && x < N && y < N && inShape[y * N + x]) out.push(y * N + x);
  }
  neighbours.set(i, out);
}

/** Which pool a cell draws its icon from: agents left, providers right, IM in the middle. */
export const side = (i: number): 'agent' | 'channel' | 'provider' =>
  col(i) < CENTER ? 'agent' : col(i) > CENTER ? 'provider' : 'channel';
