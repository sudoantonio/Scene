/** A simple click changes the ordered pair; a drag uses the pair without toggling it. */
export function clickMotionObject(sourceId: string | undefined, destinationId: string | undefined, clickedId: string | undefined) {
  if (!clickedId) return { sourceId, destinationId };
  if (clickedId === sourceId) return { sourceId: undefined, destinationId: undefined };
  if (!sourceId) return { sourceId: clickedId, destinationId: undefined };
  return { sourceId, destinationId: clickedId === destinationId ? undefined : clickedId };
}
