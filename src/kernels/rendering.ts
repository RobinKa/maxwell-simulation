import { IKernelFunctionThis } from "gpu.js"

export function getAt(field: number[][], shapeX: number, shapeY: number, x: number, y: number) {
    if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
        return 0
    }

    return field[y][x]
}

export function drawGpu(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    permittivity: number[][], permeability: number[][], gridSize: number[], cellSize: number) {
    const gx = gridSize[0]
    const gy = gridSize[1]

    const x = gx * this.thread.x! / (this.output.x as number)
    const y = gy * (1 - this.thread.y! / (this.output.y as number))

    // Make brighter for finer grids. As there are more cells, the energy is spread out instead
    // of concentrated in less cells so we need to make it brighter.
    const fieldBrightness = (0.02 * 0.02) / (cellSize * cellSize)

    const eX = getAt(electricFieldX, gx, gy, x, y)
    const eY = getAt(electricFieldY, gx, gy, x, y)
    const eZ = getAt(electricFieldZ, gx, gy, x, y)
    const eAA = fieldBrightness * fieldBrightness * (eX * eX + eY * eY + eZ * eZ)

    // Magnetic field is offset from electric field, so get value at -0.5 by interpolating 0 and 1
    const mX = getAt(magneticFieldX, gx, gy, x - 0.5, y - 0.5)
    const mY = getAt(magneticFieldY, gx, gy, x - 0.5, y - 0.5)
    const mZ = getAt(magneticFieldZ, gx, gy, x - 0.5, y - 0.5)
    const mAA = fieldBrightness * fieldBrightness * (mX * mX + mY * mY + mZ * mZ)

    // Material constants are between 1 and 100, map to [0, 1] using tanh(0.5 * (x-1))
    const permittivityValue = (2 / (1 + Math.exp(-0.5 * (getAt(permittivity, gx, gy, x, y) - 1))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.5 * (getAt(permeability, gx, gy, x, y) - 1))) - 1)

    const tileFactorX = Math.min(1, 1 / Math.round(2 * gx / this.output.x))
    const tileFactorY = Math.min(1, 1 / Math.round(2 * gy / this.output.y!))

    const dx = ((tileFactorX * x) % 1) - 0.5
    const dy = ((tileFactorY * y) % 1) - 0.5
    const f = (dx * dx + dy * dy) * Math.sqrt(2 * Math.PI)

    const dx2 = ((tileFactorX * x + 0.5) % 1) - 0.5
    const dy2 = ((tileFactorY * y + 0.5) % 1) - 0.5
    const f2 = (dx2 * dx2 + dy2 * dy2) * Math.sqrt(2 * Math.PI)

    // Smoothstep
    const bgX = -(f <= 0 ? 0 : (f >= 1 ? 1 : 3 * f * f - 2 * f * f * f))
    const bgY = -(f2 <= 0 ? 0 : (f2 >= 1 ? 1 : 3 * f2 * f2 - 2 * f2 * f2 * f2))
    const backgroundX = permittivityValue >= 0.1 ? 1 + bgX : bgX
    const backgroundY = permeabilityValue >= 0.1 ? 1 + bgY : bgY

    this.color(
        Math.min(1, eAA + 0.8 * backgroundX * permittivityValue),
        Math.min(1, eAA + mAA),
        Math.min(1, mAA + 0.8 * backgroundY * permeabilityValue))
}

// On CPU we can't use float indices so round the coordinates
export function drawCpu(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    permittivity: number[][], permeability: number[][], gridSize: number[], cellSize: number) {
    const gx = gridSize[0]
    const gy = gridSize[1]

    const fx = gx * this.thread.x! / (this.output.x as number)
    const fy = gy * (1 - this.thread.y! / (this.output.y as number))
    const x = Math.round(fx)
    const y = Math.round(fy)

    // Make brighter for finer grids. As there are more cells, the energy is spread out instead
    // of concentrated in less cells so we need to make it brighter.
    const fieldBrightness = (0.02 * 0.02) / (cellSize * cellSize)

    const eX = getAt(electricFieldX, gx, gy, x, y)
    const eY = getAt(electricFieldY, gx, gy, x, y)
    const eZ = getAt(electricFieldZ, gx, gy, x, y)
    const eAA = fieldBrightness * fieldBrightness * (eX * eX + eY * eY + eZ * eZ)

    // Magnetic field is offset from electric field, so get value at -0.5 by interpolating 0 and 1
    const mX = getAt(magneticFieldX, gx, gy, x, y)
    const mY = getAt(magneticFieldY, gx, gy, x, y)
    const mZ = getAt(magneticFieldZ, gx, gy, x, y)
    const mAA = fieldBrightness * fieldBrightness * (mX * mX + mY * mY + mZ * mZ)

    // Material constants are between 1 and 100, map to [0, 1] using tanh(0.5 * (x-1))
    const permittivityValue = (2 / (1 + Math.exp(-0.5 * (getAt(permittivity, gx, gy, x, y) - 1))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.5 * (getAt(permeability, gx, gy, x, y) - 1))) - 1)

    const tileFactorX = Math.min(1, 1 / Math.round(2 * gx / this.output.x))
    const tileFactorY = Math.min(1, 1 / Math.round(2 * gy / this.output.y!))

    const dx = ((tileFactorX * fx) % 1) - 0.5
    const dy = ((tileFactorY * fy) % 1) - 0.5
    const f = (dx * dx + dy * dy) * Math.sqrt(2 * Math.PI)

    const dx2 = ((tileFactorX * fx + 0.5) % 1) - 0.5
    const dy2 = ((tileFactorY * fy + 0.5) % 1) - 0.5
    const f2 = (dx2 * dx2 + dy2 * dy2) * Math.sqrt(2 * Math.PI)

    // Smoothstep
    const bgX = -(f <= 0 ? 0 : (f >= 1 ? 1 : 3 * f * f - 2 * f * f * f))
    const bgY = -(f2 <= 0 ? 0 : (f2 >= 1 ? 1 : 3 * f2 * f2 - 2 * f2 * f2 * f2))
    const backgroundX = permittivityValue >= 0.1 ? 1 + bgX : bgX
    const backgroundY = permeabilityValue >= 0.1 ? 1 + bgY : bgY

    this.color(
        Math.min(1, eAA + 0.8 * backgroundX * permittivityValue),
        Math.min(1, eAA + mAA),
        Math.min(1, mAA + 0.8 * backgroundY * permeabilityValue))
}