import { IKernelFunctionThis } from "gpu.js"

export function getAt(field: number[][], shapeX: number, shapeY: number, x: number, y: number) {
    if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
        return 0
    }

    return field[y][x]
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

export function updateMagneticX(this: IKernelFunctionThis, fieldY: number[][], fieldZ: number[][], permeability: number[][], magFieldX: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return magFieldX[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_Y Z - d_Z Y
    return getAt(magFieldX, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
        (getAt(fieldZ, gx, gy, x, y + 1) - getAt(fieldZ, gx, gy, x, y)))
}

export function updateMagneticY(this: IKernelFunctionThis, fieldX: number[][], fieldZ: number[][], permeability: number[][], magFieldY: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return magFieldY[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_Z X - d_X Z
    return getAt(magFieldY, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
        -(getAt(fieldZ, gx, gy, x + 1, y) - getAt(fieldZ, gx, gy, x, y)))
}

export function updateMagneticZ(this: IKernelFunctionThis, fieldX: number[][], fieldY: number[][], permeability: number[][], magFieldZ: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return magFieldZ[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_X Y - d_Y X
    return getAt(magFieldZ, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
        (getAt(fieldY, gx, gy, x + 1, y) - getAt(fieldY, gx, gy, x, y)) -
        (getAt(fieldX, gx, gy, x, y + 1) - getAt(fieldX, gx, gy, x, y)))
}

export function updateElectricX(this: IKernelFunctionThis, fieldY: number[][], fieldZ: number[][], permittivity: number[][], elFieldX: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return elFieldX[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_Y Z - d_Z Y
    return getAt(elFieldX, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
        (getAt(fieldZ, gx, gy, x, y) - getAt(fieldZ, gx, gy, x, y - 1)))
}

export function updateElectricY(this: IKernelFunctionThis, fieldX: number[][], fieldZ: number[][], permittivity: number[][], elFieldY: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return elFieldY[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_Z X - d_X Z
    return getAt(elFieldY, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
        -(getAt(fieldZ, gx, gy, x, y) - getAt(fieldZ, gx, gy, x - 1, y)))
}

export function updateElectricZ(this: IKernelFunctionThis, fieldX: number[][], fieldY: number[][], permittivity: number[][], elFieldZ: number[][], dt: number, cs: number, reflectiveBoundary: boolean) {
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
            return elFieldZ[y + yAtMinBound + yAtMaxBound][x + xAtMinBound + xAtMaxBound]
        }
    }

    // d_X Y - d_Y X
    return getAt(elFieldZ, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
        (getAt(fieldY, gx, gy, x, y) - getAt(fieldY, gx, gy, x - 1, y)) -
        (getAt(fieldX, gx, gy, x, y) - getAt(fieldX, gx, gy, x, y - 1)))
}