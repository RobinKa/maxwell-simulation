import { IKernelFunctionThis } from "gpu.js"

export function isOutOfBounds(shapeX: number, shapeY: number, x: number, y: number): number {
    return x < 0 || x >= shapeX || y < 0 || y >= shapeY ? 1 : 0
}

export function nativeSmoothStep(x: number) {
    return (x <= 0 ? 0 : (x >= 1 ? 1 : 3 * x * x - 2 * x * x * x))
}

export function renderElectricEnergy(this: IKernelFunctionThis,
    electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    gx: number, gy: number, cellSize: number) {
    const x = gx * this.thread.x! / (this.output.x as number)
    const y = gy * (1 - this.thread.y! / (this.output.y as number))

    // Make brighter for finer grids. As there are more cells, the energy is spread out instead
    // of concentrated in less cells so we need to make it brighter.
    const fieldBrightness = (0.02 * 0.02) / (cellSize * cellSize)

    const eX = (isOutOfBounds(x, y, gx, gy) * electricFieldX[y][x])
    const eY = (isOutOfBounds(x, y, gx, gy) * electricFieldY[y][x])
    const eZ = (isOutOfBounds(x, y, gx, gy) * electricFieldZ[y][x])
    const eEnergy = fieldBrightness * fieldBrightness * (eX * eX + eY * eY + eZ * eZ)

    return eEnergy
}

export function renderMagneticEnergy(this: IKernelFunctionThis,
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    gx: number, gy: number, cellSize: number) {
    const x = gx * this.thread.x! / (this.output.x as number)
    const y = gy * (1 - this.thread.y! / (this.output.y as number))

    // Make brighter for finer grids. As there are more cells, the energy is spread out instead
    // of concentrated in less cells so we need to make it brighter.
    const fieldBrightness = (0.02 * 0.02) / (cellSize * cellSize)

    // Magnetic field is offset from electric field, so get value at -0.5 by interpolating 0 and 1
    const mX = (isOutOfBounds(x - 0.5, y - 0.5, gx, gy) * magneticFieldX[y - 0.5][x - 0.5])
    const mY = (isOutOfBounds(x - 0.5, y - 0.5, gx, gy) * magneticFieldY[y - 0.5][x - 0.5])
    const mZ = (isOutOfBounds(x - 0.5, y - 0.5, gx, gy) * magneticFieldZ[y - 0.5][x - 0.5])
    const mEnergy = fieldBrightness * fieldBrightness * (mX * mX + mY * mY + mZ * mZ)

    return mEnergy
}

export function bloomExtract(this: IKernelFunctionThis, values: number[][]) {
    const val = values[this.thread.y!][this.thread.x]

    if (val > 1) {
        return val
    }

    return 0
}

export function blurVertical(this: IKernelFunctionThis, values: number[][]) {
    const x = this.thread.x
    const y = this.thread.y!

    return (
        0.227027 * values[y][x] +
        0.1945946 * (values[y + 1][x] + values[y - 1][x]) +
        0.1216216 * (values[y + 2][x] + values[y - 2][x]) +
        0.054054 * (values[y + 3][x] + values[y - 3][x]) +
        0.016216 * (values[y + 4][x] + values[y - 4][x])
    )
}

export function blurHorizontal(this: IKernelFunctionThis, values: number[][]) {
    const x = this.thread.x
    const y = this.thread.y!

    return (
        0.227027 * values[y][x] +
        0.1945946 * (values[y][x + 1] + values[y][x - 1]) +
        0.1216216 * (values[y][x + 2] + values[y][x - 2]) +
        0.054054 * (values[y][x + 3] + values[y][x - 3]) +
        0.016216 * (values[y][x + 4] + values[y][x - 4])
    )
}

export function drawGpu(this: IKernelFunctionThis,
    electricEnergy: number[][], magneticEnergy: number[][],
    electricBloom: number[][], magneticBloom: number[][],
    permittivity: number[][], permeability: number[][], conductivity: number[][],
    gx: number, gy: number) {
    const x = gx * this.thread.x! / (this.output.x as number)
    const y = gy * (1 - this.thread.y! / (this.output.y as number))

    // Material constants are between 1 and 1000, map to [0, 1] using tanh(0.5 * (x-1))
    const permittivityValue = (2 / (1 + Math.exp(-0.5 * ((isOutOfBounds(x, y, gx, gy) * permittivity[y][x]) - 1))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.5 * ((isOutOfBounds(x, y, gx, gy) * permeability[y][x]) - 1))) - 1)
    const conductivityValue = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x]) / 10

    // Display material as circles. Permittivity and permeability are offset circles from each other.
    const tileFactorX = Math.min(1, 1 / Math.round(2 * gx / this.output.x))
    const tileFactorY = Math.min(1, 1 / Math.round(2 * gy / this.output.y!))

    const dxPermittivity = ((tileFactorX * x) % 1) - 0.5
    const dyPermittivity = ((tileFactorY * y) % 1) - 0.5

    const circleDistPermittivity = (dxPermittivity * dxPermittivity + dyPermittivity * dyPermittivity) * Math.sqrt(2 * Math.PI)

    const dxPermeability = ((tileFactorX * x + 0.5) % 1) - 0.5
    const dyPermeability = ((tileFactorY * y + 0.5) % 1) - 0.5
    const circleDistPermeability = (dxPermeability * dxPermeability + dyPermeability * dyPermeability) * Math.sqrt(2 * Math.PI)

    const dxConductivity = Math.abs(((tileFactorX * x) % 1) - 0.5)
    const dyConductivity = Math.abs(((tileFactorY * y) % 1) - 0.5)

    // Smoothstep
    const bgPermittivity = -nativeSmoothStep(circleDistPermittivity)
    const bgPermeability = -nativeSmoothStep(circleDistPermeability)
    const backgroundPermittivity = permittivityValue >= 0.1 ? 1 + bgPermittivity : bgPermittivity
    const backgroundPermeability = permeabilityValue >= 0.1 ? 1 + bgPermeability : bgPermeability
    const backgroundConductivity = 0.5 * (conductivityValue >= 0 ? conductivityValue * nativeSmoothStep(dxConductivity) : -conductivityValue * nativeSmoothStep(dyConductivity))

    const eEnergy = electricEnergy[this.thread.y!][this.thread.x]
    const mEnergy = magneticEnergy[this.thread.y!][this.thread.x]
    const eBloom = electricBloom[this.thread.y!][this.thread.x]
    const mBloom = magneticBloom[this.thread.y!][this.thread.x]

    this.color(
        Math.min(1, backgroundConductivity + eEnergy + eBloom + 0.8 * backgroundPermittivity * permittivityValue),
        Math.min(1, backgroundConductivity + eBloom + mBloom),
        Math.min(1, backgroundConductivity + mEnergy + mBloom + 0.8 * backgroundPermeability * permeabilityValue)
    )
}

// On CPU we can't use float indices so round the coordinates
export function drawCpu(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
    magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
    permittivity: number[][], permeability: number[][], conductivity: number[][], gridSize: number[], cellSize: number) {
    const gx = gridSize[0]
    const gy = gridSize[1]

    const fx = gx * this.thread.x! / (this.output.x as number)
    const fy = gy * (1 - this.thread.y! / (this.output.y as number))
    const x = Math.round(fx)
    const y = Math.round(fy)

    // Make brighter for finer grids. As there are more cells, the energy is spread out instead
    // of concentrated in less cells so we need to make it brighter.
    const fieldBrightness = (0.02 * 0.02) / (cellSize * cellSize)

    const eX = (isOutOfBounds(x, y, gx, gy) * electricFieldX[y][x])
    const eY = (isOutOfBounds(x, y, gx, gy) * electricFieldY[y][x])
    const eZ = (isOutOfBounds(x, y, gx, gy) * electricFieldZ[y][x])
    const eEnergy = fieldBrightness * fieldBrightness * (eX * eX + eY * eY + eZ * eZ)

    // Magnetic field is offset from electric field, so get value at -0.5 by interpolating 0 and 1
    const mX = (isOutOfBounds(x, y, gx, gy) * magneticFieldX[y][x])
    const mY = (isOutOfBounds(x, y, gx, gy) * magneticFieldY[y][x])
    const mZ = (isOutOfBounds(x, y, gx, gy) * magneticFieldZ[y][x])
    const mEnergy = fieldBrightness * fieldBrightness * (mX * mX + mY * mY + mZ * mZ)

    // Material constants are between 1 and 1000, map to [0, 1] using tanh(0.5 * (x-1))
    const permittivityValue = (2 / (1 + Math.exp(-0.5 * ((isOutOfBounds(x, y, gx, gy) * permittivity[y][x]) - 1))) - 1)
    const permeabilityValue = (2 / (1 + Math.exp(-0.5 * ((isOutOfBounds(x, y, gx, gy) * permeability[y][x]) - 1))) - 1)
    const conductivityValue = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x]) / 10

    // Display material as circles. Permittivity and permeability are offset circles from each other.
    const tileFactorX = Math.min(1, 1 / Math.round(2 * gx / this.output.x))
    const tileFactorY = Math.min(1, 1 / Math.round(2 * gy / this.output.y!))

    const dxPermittivity = ((tileFactorX * fx) % 1) - 0.5
    const dyPermittivity = ((tileFactorY * fy) % 1) - 0.5

    const circleDistPermittivity = (dxPermittivity * dxPermittivity + dyPermittivity * dyPermittivity) * Math.sqrt(2 * Math.PI)

    const dxPermeability = ((tileFactorX * fx + 0.5) % 1) - 0.5
    const dyPermeability = ((tileFactorY * fy + 0.5) % 1) - 0.5
    const circleDistPermeability = (dxPermeability * dxPermeability + dyPermeability * dyPermeability) * Math.sqrt(2 * Math.PI)

    const dxConductivity = Math.abs(((tileFactorX * fx) % 1) - 0.5)
    const dyConductivity = Math.abs(((tileFactorY * fy) % 1) - 0.5)

    // Smoothstep
    const bgPermittivity = -nativeSmoothStep(circleDistPermittivity)
    const bgPermeability = -nativeSmoothStep(circleDistPermeability)
    const backgroundPermittivity = permittivityValue >= 0.1 ? 1 + bgPermittivity : bgPermittivity
    const backgroundPermeability = permeabilityValue >= 0.1 ? 1 + bgPermeability : bgPermeability
    const backgroundConductivity = 0.5 * (conductivityValue >= 0 ? conductivityValue * nativeSmoothStep(dxConductivity) : -conductivityValue * nativeSmoothStep(dyConductivity))

    this.color(
        Math.min(1, backgroundConductivity + eEnergy + 0.8 * backgroundPermittivity * permittivityValue),
        Math.min(1, backgroundConductivity + eEnergy + mEnergy),
        Math.min(1, backgroundConductivity + mEnergy + 0.8 * backgroundPermeability * permeabilityValue)
    )
}