/**
 * Sons curtos dos módulos (ligar/desligar), sintetizados com a Web Audio API — sem
 * arquivos de áudio. Saem pela saída padrão do sistema: seguem o volume e o mudo
 * do Windows.
 *
 * - Ligar: um clique suave de encaixe e duas notas subindo (sol → ré).
 * - Desligar: um "pop" abafado e duas notas descendo (dó → mi), a segunda caindo.
 * - Discretos (pico bem abaixo do volume máximo), cada um com menos de meio segundo.
 * - Nunca se acumulam: um som novo logo depois de outro (ligar e desligar seguidos)
 *   não toca por cima; nada fica tocando em repetição. Depois de tocar, o áudio é
 *   liberado (o 4notes não fica "segurando" a placa de som).
 */

export type ModuleSound = 'connect' | 'disconnect'

/** Volume geral (0–1): discreto. */
const MASTER = 0.55
/** Intervalo mínimo entre dois sons (ms). */
const MIN_GAP = 160

let context: AudioContext | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let lastPlayed = -Infinity

interface Voice {
  /** Frequência (Hz) e, se mudar, a final. */
  freq: number
  to?: number
  type: OscillatorType
  /** Início (s, a partir do começo do som). */
  at: number
  /** Volume do pico e quanto tempo leva para sumir (s). */
  gain: number
  decay: number
}

interface SoundSpec {
  voices: Voice[]
  /** Ruído curto filtrado (o "clique" do encaixe). */
  click: { at: number; gain: number; freq: number; q: number; length: number }
}

const SOUNDS: Record<ModuleSound, SoundSpec> = {
  connect: {
    click: { at: 0, gain: 0.16, freq: 2600, q: 1.4, length: 0.018 },
    voices: [
      { freq: 392, type: 'sine', at: 0.004, gain: 0.05, decay: 0.16 },
      { freq: 784, type: 'sine', at: 0.012, gain: 0.11, decay: 0.24 },
      { freq: 1175, type: 'sine', at: 0.085, gain: 0.09, decay: 0.32 },
      { freq: 2350, type: 'sine', at: 0.085, gain: 0.012, decay: 0.12 },
    ],
  },
  disconnect: {
    click: { at: 0, gain: 0.1, freq: 900, q: 0.9, length: 0.024 },
    voices: [
      { freq: 1047, type: 'sine', at: 0.006, gain: 0.08, decay: 0.18 },
      { freq: 659, to: 590, type: 'sine', at: 0.09, gain: 0.09, decay: 0.3 },
      { freq: 330, to: 300, type: 'sine', at: 0.09, gain: 0.035, decay: 0.22 },
    ],
  },
}

/** Duração de um som (s): a última nota e o rabo dela. */
export function soundLength(kind: ModuleSound): number {
  return Math.max(...SOUNDS[kind].voices.map((voice) => voice.at + voice.decay * 1.6)) + 0.02
}

/** Monta o som em `ctx`, começando em `start` (s). */
function schedule(ctx: BaseAudioContext, kind: ModuleSound, start: number): void {
  const spec = SOUNDS[kind]
  const master = ctx.createGain()
  master.gain.value = MASTER
  master.connect(ctx.destination)

  // Clique: ruído branco curtinho, passando por um filtro
  const { click } = spec
  const length = Math.ceil(ctx.sampleRate * click.length)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // Ruído determinístico (o mesmo som toda vez)
  let seed = 7
  for (let i = 0; i < length; i++) {
    seed = (seed * 16807) % 2147483647
    data[i] = ((seed / 2147483647) * 2 - 1) * (1 - i / length) ** 2
  }
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = click.freq
  filter.Q.value = click.q
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = click.gain
  noise.connect(filter).connect(noiseGain).connect(master)
  noise.start(start + click.at)

  for (const voice of spec.voices) {
    const t = start + voice.at
    const osc = ctx.createOscillator()
    osc.type = voice.type
    osc.frequency.setValueAtTime(voice.freq, t)
    if (voice.to) osc.frequency.exponentialRampToValueAtTime(voice.to, t + voice.decay)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(voice.gain, t + 0.006)
    env.gain.exponentialRampToValueAtTime(0.0001, t + voice.decay * 1.6)
    osc.connect(env).connect(master)
    osc.start(t)
    osc.stop(t + voice.decay * 1.6 + 0.02)
  }
}

/**
 * Toca o som de ligar ou desligar um módulo. false = não tocou (sem áudio, janela
 * escondida ou outro som acabou de tocar).
 */
export function playModuleSound(kind: ModuleSound): boolean {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined' || document.hidden) return false
  const now = performance.now()
  if (now - lastPlayed < MIN_GAP) return false
  lastPlayed = now
  try {
    context ??= new AudioContext({ latencyHint: 'interactive' })
    if (context.state === 'suspended') void context.resume()
    schedule(context, kind, context.currentTime + 0.01)
    // Libera o áudio do sistema depois que o som acaba
    if (releaseTimer) clearTimeout(releaseTimer)
    releaseTimer = setTimeout(() => void context?.suspend().catch(() => undefined), (soundLength(kind) + 0.5) * 1000)
    return true
  } catch (error) {
    console.warn('[4notes] Não foi possível tocar o som:', error)
    return false
  }
}

/** O som renderizado fora do alto-falante (para os testes): as amostras, em mono. */
export async function renderModuleSound(kind: ModuleSound, sampleRate = 44100): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(soundLength(kind) * sampleRate), sampleRate)
  schedule(ctx, kind, 0)
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}
