export const getRenamePopoverPosition = (x: number, y: number) => {
  const width = 320;
  const height = 168;
  const gutter = 12;
  const maxX = Math.max(gutter, window.innerWidth - width - gutter);
  const maxY = Math.max(gutter, window.innerHeight - height - gutter);

  return {
    x: Math.min(Math.max(x, gutter), maxX),
    y: Math.min(Math.max(y, gutter), maxY),
  };
};
