/** Microphone level meter for the waveform visualizer (Web Audio AnalyserNode). */
export class MicAnalyser {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;

  async start(): Promise<boolean> {
    if (this.analyser) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;
      src.connect(this.analyser);
      this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      return true;
    } catch {
      return false;
    }
  }

  /** Frequency bins 0..1 (length = fftSize/2). Empty when not running. */
  levels(): Float32Array {
    if (!this.analyser || !this.data) return new Float32Array(0);
    this.analyser.getByteFrequencyData(this.data);
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < this.data.length; i++) out[i] = this.data[i] / 255;
    return out;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
  }
}
