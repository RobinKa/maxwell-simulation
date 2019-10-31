import { IKernelFunctionThis } from "gpu.js"

export function getAt(texture: number[][], shapeX: number, shapeY: number, x: number, y: number) {
    if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
        return 0
    }

    return texture[y][x]
}

export function makeFieldTexture(this: IKernelFunctionThis, value: number) {
    return value
}

export function copyTexture(this: IKernelFunctionThis, texture: number[][]) {
    return texture[this.thread.y!][this.thread.x]
}

export function copyTextureWithBounds(this: IKernelFunctionThis, texture: number[][], bounds: number[], outOfBoundsValue: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number

    if (x < 0 || y < 0 || x >= bounds[0] || y >= bounds[1]) {
        return outOfBoundsValue
    }

    return texture[y][x]
}

export function drawSquare(this: IKernelFunctionThis, pos: number[], size: number, value: number, keep: number, texture: number[][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    const oldValue = getAt(texture, gx, gy, x, y)

    const within = Math.max(Math.abs(pos[0] - x), Math.abs(pos[1] - y)) < size

    return within ? value + keep * oldValue : oldValue
}

export function drawCircle(this: IKernelFunctionThis, pos: number[], radius: number, value: number, keep: number, texture: number[][]) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    const oldValue = getAt(texture, gx, gy, x, y)

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

    return getAt(field, gx, gy, x, y) + getAt(source, gx, gy, x, y) * dt
}

export function decaySource(this: IKernelFunctionThis, source: number[][], dt: number) {
    const x = this.thread.x as number
    const y = this.thread.y! as number
    const gx = this.output.x as number
    const gy = this.output.y as number

    return getAt(source, gx, gy, x, y) * Math.pow(0.1, dt)
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

    const perm = getAt(permeability, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Y Z - d_Z Y, but d_Z = 0 in 2d
    return alpha * getAt(magneticFieldX, gx, gy, x, y) - beta * (
        (getAt(electricFieldZ, gx, gy, x, y + 1) - getAt(electricFieldZ, gx, gy, x, y)))
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

    const perm = getAt(permeability, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Z X - d_X Z, but d_Z = 0 in 2d
    return alpha * getAt(magneticFieldY, gx, gy, x, y) - beta * (
        -(getAt(electricFieldZ, gx, gy, x + 1, y) - getAt(electricFieldZ, gx, gy, x, y)))
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

    const perm = getAt(permeability, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_X Y - d_Y X
    return alpha * getAt(magneticFieldZ, gx, gy, x, y) - beta * (
        (getAt(electricFieldY, gx, gy, x + 1, y) - getAt(electricFieldY, gx, gy, x, y)) -
        (getAt(electricFieldX, gx, gy, x, y + 1) - getAt(electricFieldX, gx, gy, x, y)))
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

    const perm = getAt(permittivity, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Y Z - d_Z Y, but d_Z = 0 in 2d
    return alpha * getAt(electricFieldX, gx, gy, x, y) + beta * (
        (getAt(magneticFieldZ, gx, gy, x, y) - getAt(magneticFieldZ, gx, gy, x, y - 1)))
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

    const perm = getAt(permittivity, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_Z X - d_X Z, but d_Z = 0 in 2d
    return alpha * getAt(electricFieldY, gx, gy, x, y) + beta * (
        -(getAt(magneticFieldZ, gx, gy, x, y) - getAt(magneticFieldZ, gx, gy, x - 1, y)))
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

    const perm = getAt(permittivity, gx, gy, x, y)
    const cond = getAt(conductivity, gx, gy, x, y)
    const c = cond * dt / (2 * perm)
    const d = 1 / (1 + c)
    const alpha = (1 - c) * d
    const beta = dt / (perm * cellSize) * d

    // d_X Y - d_Y X
    return alpha * getAt(electricFieldZ, gx, gy, x, y) + beta * (
        (getAt(magneticFieldY, gx, gy, x, y) - getAt(magneticFieldY, gx, gy, x - 1, y)) -
        (getAt(magneticFieldX, gx, gy, x, y) - getAt(magneticFieldX, gx, gy, x, y - 1)))
}