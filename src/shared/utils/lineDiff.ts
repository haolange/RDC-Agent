export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

/**
 * Line diff from the longest common subsequence, so an inserted or removed line
 * does not mark every following line as changed. Inputs are small text files.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before ? before.split(/\r?\n/u) : [];
  const right = after ? after.split(/\r?\n/u) : [];
  const columns = right.length + 1;
  const common = new Uint32Array((left.length + 1) * columns);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      common[row * columns + column] =
        left[row] === right[column]
          ? common[(row + 1) * columns + column + 1] + 1
          : Math.max(common[(row + 1) * columns + column], common[row * columns + column + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      lines.push({ kind: 'same', text: left[row] });
      row += 1;
      column += 1;
    } else if (common[(row + 1) * columns + column] >= common[row * columns + column + 1]) {
      lines.push({ kind: 'remove', text: left[row] });
      row += 1;
    } else {
      lines.push({ kind: 'add', text: right[column] });
      column += 1;
    }
  }
  for (; row < left.length; row += 1) lines.push({ kind: 'remove', text: left[row] });
  for (; column < right.length; column += 1) lines.push({ kind: 'add', text: right[column] });
  return lines;
}

/** A run of unchanged lines folded away by `collapseUnchanged`. */
export interface DiffGap {
  kind: 'gap';
  count: number;
}

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs into gaps. */
export function collapseUnchanged(lines: DiffLine[], context: number): Array<DiffLine | DiffGap> {
  const keep = lines.map((line) => line.kind !== 'same');
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let offset = 1; offset <= context; offset += 1) {
      if (index - offset >= 0) keep[index - offset] = true;
      if (index + offset < lines.length) keep[index + offset] = true;
    }
  });
  const folded: Array<DiffLine | DiffGap> = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (hidden > 0) folded.push({ kind: 'gap', count: hidden });
      hidden = 0;
      folded.push(line);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) folded.push({ kind: 'gap', count: hidden });
  return folded;
}
