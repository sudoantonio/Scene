export async function inspectAudio(source: string): Promise<{ duration: number; waveform: number[] }> {
  const bytes = await (await fetch(source)).arrayBuffer();
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error('Analisi audio non disponibile.');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const channel = buffer.getChannelData(0);
    const bars = Math.min(8192, Math.max(120, Math.ceil(buffer.duration * 60)));
    const windowSize = Math.max(1, Math.floor(channel.length / bars));
    const waveform = Array.from({ length: bars }, (_, index) => {
      const from = index * windowSize;
      const to = Math.min(channel.length, from + windowSize);
      let peak = 0;
      for (let sample = from; sample < to; sample += Math.max(1, Math.floor(windowSize / 180))) peak = Math.max(peak, Math.abs(channel[sample]));
      return Number(Math.max(.025, Math.min(1, peak)).toFixed(3));
    });
    return { duration: buffer.duration, waveform };
  } finally { void context.close(); }
}
