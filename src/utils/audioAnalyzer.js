// src/utils/audioAnalyzer.js — Detects speaking activity from audio streams

export class AudioAnalyzer {
  constructor() {
    this.context = null;
    this.analyzers = new Map(); // id -> { analyzerNode, source, interval }
  }

  _getContext() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.context;
  }

  attach(id, stream, onSpeakingChange) {
    if (!stream || this.analyzers.has(id)) return;

    try {
      const ctx = this._getContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyzer = ctx.createAnalyser();
      analyzer.fftSize = 512;
      analyzer.smoothingTimeConstant = 0.8;
      source.connect(analyzer);

      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      let speaking = false;

      const interval = setInterval(() => {
        analyzer.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const isSpeaking = avg > 15;
        if (isSpeaking !== speaking) {
          speaking = isSpeaking;
          onSpeakingChange(id, speaking);
        }
      }, 100);

      this.analyzers.set(id, { analyzer, source, interval });
    } catch (e) {
      // Silently fail if audio context not available
    }
  }

  detach(id) {
    const entry = this.analyzers.get(id);
    if (!entry) return;
    clearInterval(entry.interval);
    try { entry.source.disconnect(); } catch (_) {}
    this.analyzers.delete(id);
  }

  detachAll() {
    for (const id of this.analyzers.keys()) {
      this.detach(id);
    }
    try { this.context?.close(); } catch (_) {}
  }
}