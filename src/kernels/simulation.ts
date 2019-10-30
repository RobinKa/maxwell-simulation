import { IKernelFunctionThis } from "gpu.js"

export function getAt(texture: number[][][], shapeX: number, shapeY: number, x: number, y: number, z: number) {
    if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
        return 0
    }

    return texture[z][y][x]
}

export function makeFieldTexture(this: IKernelFunctionThis, value: number[]) {
    return value[this.thread.z!]
}

export function copyTexture(this: IKernelFunctionThis, texture: number[][][]) {
    return texture[this.thread.z!][this.thread.y!][this.thread.x]
}

export function copyTextureWithBounds(this: IKernelFunctionThis, texture: number[][][], bounds: number[], outOfBoundsValue: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number

    if (x < 0 || y < 0 || x >= bounds[0] || y >= bounds[1]) {
        return outOfBoundsValue
    }

    return texture[z][y][x]
}

export function drawSquare(this: IKernelFunctionThis, pos: number[], size: number, value: number[], keep: number, texture: number[][][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    const oldValue = getAt(texture, gx, gy, x, y, z)

    const within = Math.max(Math.abs(pos[0] - x), Math.abs(pos[1] - y)) < size

    return within ? value[z] + keep * oldValue : oldValue
}

export function drawCircle(this: IKernelFunctionThis, pos: number[], radius: number, value: number[], keep: number, texture: number[][][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    const oldValue = getAt(texture, gx, gy, x, y, z)

    const dx = pos[0] - x
    const dy = pos[1] - y

    const within = dx * dx + dy * dy < radius * radius

    return within ? value[z] + keep * oldValue : oldValue
}

export function injectSource(this: IKernelFunctionThis, source: number[][][], field: number[][][], dt: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    return getAt(field, gx, gy, x, y, z) + getAt(source, gx, gy, x, y, z) * dt
}

export function decaySource(this: IKernelFunctionThis, source: number[][][], dt: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    return getAt(source, gx, gy, x, y, z) * Math.pow(0.1, dt)
}

export function updateMagnetic(this: IKernelFunctionThis, electricField: number[][][], magneticField: number[][][], permeability: number[][][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        // Return value towards center for boundary points
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return magneticField[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound][z]
        }
    }

    const coordIndex = z % 3 // 0 x, 1 y, 2 z
    const partIndex = Math.floor(z / 3) // 0 real, 1 imag

    // z meaning
    // 0: real x
    // 1: real y
    // 2: real z
    // 3: imag x
    // 4: imag y
    // 5: imag z

    const permReal = getAt(permeability, gx, gy, x, y, 0)
    const permImag = getAt(permeability, gx, gy, x, y, 1)
    const permMagSq = permReal * permReal + permImag * permImag

    const invPerm = (partIndex === 0 ? permReal : permImag) / permMagSq

    const oldValue = getAt(magneticField, gx, gy, x, y, z)

    // x = dy z - dz y
    // y = dz x - dx z
    // z = dx y - dy x

    // 0 = d1 2 - d2 1
    // 1 = d2 0 - d0 2
    // 2 = d0 1 - d1 0

    // z = d(z+1) (z+2) - d(z+2) z+1

    const dLeft = [partIndex === 2 ? 1 : 0, partIndex === 0 ? 1 : 0, partIndex === 1 ? 1 : 0]
    const dRight = [partIndex === 1 ? 1 : 0, partIndex === 2 ? 1 : 0, partIndex === 0 ? 1 : 0]

    return oldValue - (dt * invPerm * cellSize) *
        ((getAt(electricField, gx, gy, x + dLeft[0], y + dLeft[1], (coordIndex + 2) % 3 + 3 * partIndex) - getAt(electricField, gx, gy, x, y, (coordIndex + 2) % 3 + 3 * partIndex)) - 
        (getAt(electricField, gx, gy, x + dRight[0], y + dRight[1], (coordIndex + 1) % 3 + 3 * partIndex) - getAt(electricField, gx, gy, x, y, (coordIndex + 1) % 3 + 3 * partIndex)))
}

export function updateElectric(this: IKernelFunctionThis, electricField: number[][][], magneticField: number[][][], permittivity: number[][][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const z = this.thread.z! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        // Return value towards center for boundary points
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return electricField[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound][z]
        }
    }

    const coordIndex = z % 3
    const partIndex = Math.floor(z / 3)

    const permReal = getAt(permittivity, gx, gy, x, y, 0)
    const permImag = getAt(permittivity, gx, gy, x, y, 1)
    const permMagSq = permReal * permReal + permImag * permImag

    const invPerm = (partIndex === 0 ? permReal : permImag) / permMagSq

    const oldValue = getAt(electricField, gx, gy, x, y, z)

    const dLeft = [partIndex === 2 ? 1 : 0, partIndex === 0 ? 1 : 0, partIndex === 1 ? 1 : 0]
    const dRight = [partIndex === 1 ? 1 : 0, partIndex === 2 ? 1 : 0, partIndex === 0 ? 1 : 0]

    return oldValue - (dt * invPerm * cellSize) *
        ((getAt(magneticField, gx, gy, x, y, (coordIndex + 2) % 3 + 3 * partIndex) - getAt(magneticField, gx, gy, x - dLeft[0], y - dLeft[1], (coordIndex + 2) % 3 + 3 * partIndex)) - 
        (getAt(magneticField, gx, gy, x, y, (coordIndex + 1) % 3 + 3 * partIndex) - getAt(magneticField, gx, gy, x - dLeft[0], y - dRight[1], (coordIndex + 1) % 3 + 3 * partIndex)))
}