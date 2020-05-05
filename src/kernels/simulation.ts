import { IKernelFunctionThis } from "gpu.js"

export function isOutOfBounds(shapeX: number, shapeY: number, x: number, y: number): number {
    return x < 0 || x >= shapeX || y < 0 || y >= shapeY ? 1 : 0
}

export function makeFieldTexture(this: IKernelFunctionThis, value: number) {
    return value
}

export function copyTexture(this: IKernelFunctionThis, texture: number[][]) {
    return texture[this.thread.y!][this.thread.x]
}

export function copyTextureWithBounds(this: IKernelFunctionThis, texture: number[][], boundsX: number, boundsY: number, outOfBoundsValue: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const bounds: [number, number] = [boundsX, boundsY]

    if (x < 0 || y < 0 || x >= bounds[0] || y >= bounds[1]) {
        return outOfBoundsValue
    }

    return texture[y][x]
}

export function copyTextureWithBoundsFromEncoded(this: IKernelFunctionThis, texture: Uint8Array, boundsX: number, boundsY: number, outOfBoundsValue: number) {
    const x = this.thread.x
    const y = this.thread.y!
    const gx = this.output.x
    const bounds: [number, number] = [boundsX, boundsY]

    if (x < 0 || y < 0 || x >= bounds[0] || y >= bounds[1]) {
        return outOfBoundsValue
    }

    const u1 = texture[y * gx * 4 + x * 4 + 0]
    const u2 = texture[y * gx * 4 + x * 4 + 1]
    const u3 = texture[y * gx * 4 + x * 4 + 2]
    const u4 = texture[y * gx * 4 + x * 4 + 3]

    const sign = Math.pow(-1, (u1 >>> 7) & 1)
    const exp = ((u1 & 0x7F) << 1) + ((u2 & 0x80) >>> 7) - 127
    const mant = ((u2 & 0x7F) << (7 + 8)) + (u3 << 8) + u4

    let mantDec = 1
    for (let i = 0; i < 23; i++) {
        mantDec += ((mant >>> i) & 1) / Math.pow(2, 22 - i)
    }

    return Math.pow(2, exp)
    //return sign * mantDec * Math.pow(2, exp)
}

export function drawSquare(this: IKernelFunctionThis, posX: number, posY: number, size: number, value: number, keep: number, texture: number[][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number
    const pos: [number, number] = [posX, posY]

    const oldValue = (isOutOfBounds(x, y, gx, gy) * texture[y][x])

    const within = Math.max(Math.abs(pos[0] - x), Math.abs(pos[1] - y)) < size

    return within ? value + keep * oldValue : oldValue
}

export function drawCircle(this: IKernelFunctionThis, posX: number, posY: number, radius: number, value: number, keep: number, texture: number[][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number
    const pos: [number, number] = [posX, posY]

    const oldValue = (isOutOfBounds(x, y, gx, gy) * texture[y][x])

    const dx = pos[0] - x
    const dy = pos[1] - y

    const within = dx * dx + dy * dy < radius * radius

    return within ? value + keep * oldValue : oldValue
}

export function injectSource(this: IKernelFunctionThis, source: number[][], field: number[][], dt: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    return (isOutOfBounds(x, y, gx, gy) * field[y][x]) + (isOutOfBounds(x, y, gx, gy) * source[y][x]) * dt
}

export function decaySource(this: IKernelFunctionThis, source: number[][], dt: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    return (isOutOfBounds(x, y, gx, gy) * source[y][x]) * Math.pow(0.1, dt)
}

export function updateMagneticX(this: IKernelFunctionThis, electricFieldZ: number[][], permeability: number[][], conductivity: number[][], magneticFieldX: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return magneticFieldX[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permeability[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Y Z - d_Z Y, but d_Z = 0 in 2d
    return alpha * (isOutOfBounds(x, y, gx, gy) * magneticFieldX[y][x]) - beta * (
        ((isOutOfBounds(x, y + 1, gx, gy) * electricFieldZ[y + 1][x]) - (isOutOfBounds(x, y, gx, gy) * electricFieldZ[y][x])))
}

export function updateMagneticY(this: IKernelFunctionThis, electricFieldZ: number[][], permeability: number[][], conductivity: number[][], magneticFieldY: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return magneticFieldY[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permeability[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Z X - d_X Z, but d_Z = 0 in 2d
    return alpha * (isOutOfBounds(x, y, gx, gy) * magneticFieldY[y][x]) - beta * (
        -((isOutOfBounds(x + 1, y, gx, gy) * electricFieldZ[y][x + 1]) - (isOutOfBounds(x, y, gx, gy) * electricFieldZ[y][x])))
}

export function updateMagneticZ(this: IKernelFunctionThis, electricFieldX: number[][], electricFieldY: number[][], permeability: number[][], conductivity: number[][], magneticFieldZ: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return magneticFieldZ[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permeability[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_X Y - d_Y X
    return alpha * (isOutOfBounds(x, y, gx, gy) * magneticFieldZ[y][x]) - beta * (
        ((isOutOfBounds(x + 1, y, gx, gy) * electricFieldY[y][x + 1]) - (isOutOfBounds(x, y, gx, gy) * electricFieldY[y][x])) -
        ((isOutOfBounds(x, y + 1, gx, gy) * electricFieldX[y + 1][x]) - (isOutOfBounds(x, y, gx, gy) * electricFieldX[y][x])))
}

export function updateElectricX(this: IKernelFunctionThis, magneticFieldZ: number[][], permittivity: number[][], conductivity: number[][], electricFieldX: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return electricFieldX[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permittivity[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Y Z - d_Z Y, but d_Z = 0 in 2d
    return alpha * (isOutOfBounds(x, y, gx, gy) * electricFieldX[y][x]) + beta * (
        ((isOutOfBounds(x, y, gx, gy) * magneticFieldZ[y][x]) - (isOutOfBounds(x, y - 1, gx, gy) * magneticFieldZ[y - 1][x])))
}

export function updateElectricY(this: IKernelFunctionThis, magneticFieldZ: number[][], permittivity: number[][], conductivity: number[][], electricFieldY: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return electricFieldY[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permittivity[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Z X - d_X Z, but d_Z = 0 in 2d
    return alpha * (isOutOfBounds(x, y, gx, gy) * electricFieldY[y][x]) + beta * (
        -((isOutOfBounds(x, y, gx, gy) * magneticFieldZ[y][x]) - (isOutOfBounds(x - 1, y, gx, gy) * magneticFieldZ[y][x - 1])))
}

export function updateElectricZ(this: IKernelFunctionThis, magneticFieldX: number[][], magneticFieldY: number[][], permittivity: number[][], conductivity: number[][], electricFieldZ: number[][], dt: number, cellSize: number, reflectiveBoundary: boolean) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    if (!reflectiveBoundary) {
        const xAtMinBound = x < 2 ? 1 : 0
        const xAtMaxBound = x + 2 >= gx ? -1 : 0
        const yAtMinBound = y < 2 ? 1 : 0
        const yAtMaxBound = y + 2 >= gy ? -1 : 0
        if (xAtMinBound !== 0 || xAtMaxBound !== 0 || yAtMinBound !== 0 || yAtMaxBound !== 0) {
            return electricFieldZ[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    const perm = (isOutOfBounds(x, y, gx, gy) * permittivity[y][x])
    const cond = (isOutOfBounds(x, y, gx, gy) * conductivity[y][x])
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_X Y - d_Y X
    return alpha * (isOutOfBounds(x, y, gx, gy) * electricFieldZ[y][x]) + beta * (
        ((isOutOfBounds(x, y, gx, gy) * magneticFieldY[y][x]) - (isOutOfBounds(x - 1, y, gx, gy) * magneticFieldY[y][x - 1])) -
        ((isOutOfBounds(x, y, gx, gy) * magneticFieldX[y][x]) - (isOutOfBounds(x, y - 1, gx, gy) * magneticFieldX[y - 1][x])))
}