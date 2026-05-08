/**
 * Noise gate AudioWorklet processor.
 * Smoothly mutes audio below a RMS threshold to cut background noise.
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._threshold = 0.008;
    this._gain = 0;
    // Attack: how fast gate opens (ms → samples)
    this._attackStep = 1 / (0.005 * sampleRate);
    // Release: how fast gate closes
    this._releaseStep = 1 / (0.12 * sampleRate);

    this.port.onmessage = ({ data }) => {
      if (data.threshold !== undefined) this._threshold = data.threshold;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    // RMS of this frame
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const open = rms > this._threshold;

    for (let i = 0; i < input.length; i++) {
      this._gain = open
        ? Math.min(1, this._gain + this._attackStep)
        : Math.max(0, this._gain - this._releaseStep);
      output[i] = input[i] * this._gain;
    }

    return true;
  }
}

registerProcessor("noise-gate-processor", NoiseGateProcessor);
