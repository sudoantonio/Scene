export const isVideoFile = (path: string) => /\.(mp4|m4v|mov|webm)$/i.test(path);

export async function inspectVideo(sourcePath: string): Promise<{ sourcePath: string; duration: number; aspectRatio: number }> {
  const source = window.abaco ? await window.abaco.videoSource(sourcePath) : sourcePath;
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error('Video metadata could not be loaded.')), 15000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const metadata = { sourcePath, duration: video.duration, aspectRatio: video.videoWidth / video.videoHeight };
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (error) reject(error);
      else resolve(metadata);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoHeight) finish(new Error('Video duration or dimensions are unavailable.'));
      else finish();
    };
    video.onerror = () => finish(new Error('Video format could not be decoded.'));
    video.src = source;
  });
}

export function videoTime(frame: number, startFrame: number, fps: number, duration: number) {
  return Math.max(0, Math.min(Math.max(0, duration - .001), (frame - startFrame) / fps));
}
