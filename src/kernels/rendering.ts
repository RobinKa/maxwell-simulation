import { IKernelFunctionThis } from "gpu.js"

export function getAt(field: number[][], shapeX: number, shapeY: number, x: number, y: number) {
    if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
        return 0
    }

    return field[y][x]
}

export function drawGpu(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    permittivity: number[][], permeability: number[][], gridSize: number[]) {
    const gx = gridSize[0]
    const gy = gridSize[1]

    const x = gx * this.thread.x! / (this.output.x as number)
    const y = gy * (1 - this.thread.y! / (this.output.y as number))

    const eAA =
        getAt(electricFieldX, gx, gy, x, y) * getAt(electricFieldX, gx, gy, x, y) +
        getAt(electricFieldY, gx, gy, x, y) * getAt(electricFieldY, gx, gy, x, y) +
        getAt(electricFieldZ, gx, gy, x, y) * getAt(electricFieldZ, gx, gy, x, y)

    // Magnetic field is offset from electric field, so get value at +0.5 by interpolating 0 and 1
    const magXAA = getAt(magneticFieldX, gx, gy, x - 0.5, y - 0.5)
    const magYAA = getAt(magneticFieldY, gx, gy, x - 0.5, y - 0.5)
    const magZAA = getAt(magneticFieldZ, gx, gy, x - 0.5, y - 0.5)

    const mAA = magXAA * magXAA + magYAA * magYAA + magZAA * magZAA

    // Material constants are between 1 and 100, map to [0, 1] using tanh(0.5 * x)
    const permittivityValue = (2 / (1 + Math.exp(-0.4 * (getAt(permittivity, gx, gy, x, y)))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.4 * (getAt(permeability, gx, gy, x, y)))) - 1)

    const tileFactorX = Math.max(1, gridSize[0] / this.output.x)
    const tileFactorY = Math.max(1, gridSize[1] / this.output.y!)

    const backgroundX = (Math.abs((tileFactorX * x) % 1 - 0.5) < 0.25 ? 1 : 0) * (Math.abs((tileFactorY * y) % 1 - 0.5) < 0.25 ? 1 : 0)
    const backgroundY = 1 - backgroundX

    const scale = 15
    this.color(
        Math.min(1, eAA / scale + 0.8 * backgroundX * permittivityValue),
        Math.min(1, eAA / scale + mAA / scale),
        Math.min(1, mAA / scale + 0.8 * backgroundY * permeabilityValue))
}

// On CPU we can't use float indices so round the coordinates
export function drawCpu(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    permittivity: number[][], permeability: number[][], gridSize: number[]) {
    const gx = gridSize[0]
    const gy = gridSize[1]

    const fx = gx * this.thread.x! / (this.output.x as number)
    const fy = gy * (1 - this.thread.y! / (this.output.y as number))
    const x = Math.round(fx)
    const y = Math.round(fy)

    const eAA =
        getAt(electricFieldX, gx, gy, x, y) * getAt(electricFieldX, gx, gy, x, y) +
        getAt(electricFieldY, gx, gy, x, y) * getAt(electricFieldY, gx, gy, x, y) +
        getAt(electricFieldZ, gx, gy, x, y) * getAt(electricFieldZ, gx, gy, x, y)

    // Magnetic field is offset from electric field, so get value at +0.5 by interpolating 0 and 1
    const magXAA = getAt(magneticFieldX, gx, gy, x, y)
    const magYAA = getAt(magneticFieldY, gx, gy, x, y)
    const magZAA = getAt(magneticFieldZ, gx, gy, x, y)

    const mAA = magXAA * magXAA + magYAA * magYAA + magZAA * magZAA

    // Material constants are between 1 and 100, map to [0, 1] using tanh(0.5 * x)
    const permittivityValue = (2 / (1 + Math.exp(-0.4 * (getAt(permittivity, gx, gy, x, y)))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.4 * (getAt(permeability, gx, gy, x, y)))) - 1)

    const tileFactorX = Math.max(1, gridSize[0] / this.output.x)
    const tileFactorY = Math.max(1, gridSize[1] / this.output.y!)

    const backgroundX = (Math.abs((tileFactorX * fx) % 1 - 0.5) < 0.25 ? 1 : 0) * (Math.abs((tileFactorY * fy) % 1 - 0.5) < 0.25 ? 1 : 0)
    const backgroundY = 1 - backgroundX

    const scale = 15
    this.color(
        Math.min(1, eAA / scale + 0.8 * backgroundX * permittivityValue),
        Math.min(1, eAA / scale + mAA / scale),
        Math.min(1, mAA / scale + 0.8 * backgroundY * permeabilityValue))
}