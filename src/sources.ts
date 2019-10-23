import { Simulator } from "./simulator"

export interface SignalSource {
    inject(simulator: Simulator, dt: number): void
}

export class PointSignalSource implements SignalSource {
    constructor(public amplitude: number, public frequency: number, public position: [number, number], public turnOffTime?: number) {

    }

    inject = (simulator: Simulator, dt: number) => {
        const t = simulator.getData().time
        if (this.turnOffTime === undefined || t <= this.turnOffTime) {
            const amplitude = -this.amplitude * Math.cos(2 * Math.PI * this.frequency * t) * dt
            simulator.injectSignal(this.position, 1, amplitude, dt)
        }
    }
}

