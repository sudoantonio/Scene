type CaptureCheckpoint = { frame: number; projectId: string; draw(): void };
let checkpoint: CaptureCheckpoint | undefined;

/** Registered only after the camera/capture props have committed in the 3D root. */
export function registerViewportCapture(next: CaptureCheckpoint) {
  checkpoint = next;
  return () => { if (checkpoint === next) checkpoint = undefined; };
}

export async function drawCommittedCapture(frame: number, projectId: string, nextPaint: () => Promise<void>, now = Date.now, timeout = 15000) {
  const deadline = now() + timeout;
  for (;;) {
    await nextPaint();
    if (checkpoint?.frame === frame && checkpoint.projectId === projectId) {
      checkpoint.draw();
      return;
    }
    if (now() >= deadline) throw new Error('The camera viewport did not finish updating.');
  }
}
