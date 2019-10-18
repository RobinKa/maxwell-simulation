import { GPU, IKernelRunShortcut } from "gpu.js"

export type FlatScalarField3D = {
    values: number[]
    shape: [number, number, number]
}

function makeScalarField3D(shape: [number, number, number], value: number = 0) {
    const field = []
    for (let i = 0; i < shape[0] * shape[1] * shape[2]; i++) {
        field.push(value)
    }
    return { values: field, shape: shape }
}

export function indexToCoords(index: number, shape: [number, number, number]): [number, number, number] {
    return [index % shape[0], Math.floor(index / shape[0]) % shape[1], Math.floor(index / (shape[0] * shape[1])) % shape[2]]
}

export function setScalarField3DValue(field: FlatScalarField3D, x: number, y: number, z: number, value: number) {
    field.values[x + y * field.shape[0] + z * field.shape[0] * field.shape[1]] = value
}

export function addScalarField3DValue(field: FlatScalarField3D, x: number, y: number, z: number, value: number) {
    field.values[x + y * field.shape[0] + z * field.shape[0] * field.shape[1]] += value
}

export function updateScalarField3DValue(field: FlatScalarField3D, x: number, y: number, z: number, getValue: (current: number) => number) {
    field.values[x + y * field.shape[0] + z * field.shape[0] * field.shape[1]] = getValue(field.values[x + y * field.shape[0] + z * field.shape[0] * field.shape[1]])
}

export function getScalarField3DValue(field: FlatScalarField3D, x: number, y: number, z: number) {
    return field.values[x + y * field.shape[0] + z * field.shape[0] * field.shape[1]]
}

export type SimulationData = {
    time: number
    electricFieldX: FlatScalarField3D
    electricFieldY: FlatScalarField3D
    electricFieldZ: FlatScalarField3D
    magneticFieldX: FlatScalarField3D
    magneticFieldY: FlatScalarField3D
    magneticFieldZ: FlatScalarField3D
    permittivity: FlatScalarField3D
    permeability: FlatScalarField3D
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    getData: () => SimulationData
}

export class FDTDSimulator implements Simulator {
    private data: SimulationData

    private gpu: GPU
    private updateMagneticX: IKernelRunShortcut
    private updateMagneticY: IKernelRunShortcut
    private updateMagneticZ: IKernelRunShortcut
    private updateElectricX: IKernelRunShortcut
    private updateElectricY: IKernelRunShortcut
    private updateElectricZ: IKernelRunShortcut

    constructor(gridSize: [number, number, number], cellSize: number) {
        this.data = {
            time: 0,
            electricFieldX: makeScalarField3D(gridSize),
            electricFieldY: makeScalarField3D(gridSize),
            electricFieldZ: makeScalarField3D(gridSize),
            magneticFieldX: makeScalarField3D(gridSize),
            magneticFieldY: makeScalarField3D(gridSize),
            magneticFieldZ: makeScalarField3D(gridSize),
            permittivity: makeScalarField3D(gridSize, 1),
            permeability: makeScalarField3D(gridSize, 1),
        }

        const cellCount = gridSize[0] * gridSize[1] * gridSize[2]

        this.gpu = new GPU()

        function getAt(field: number[], shapeX: number, shapeY: number, shapeZ: number, x: number, y: number, z: number) {
            if (x < 0 || x >= shapeX || y < 0 || y >= shapeY || z < 0 || z >= shapeZ) {
                return 0
            }

            return field[x + y * shapeX + z * shapeX * shapeZ]
        }

        function getX(index: number, shapeX: number) {
            return index % shapeX
        }

        function getY(index: number, shapeX: number, shapeY: number) {
            return Math.floor(index / shapeX) % shapeY
        }

        function getZ(index: number, shapeX: number, shapeY: number, shapeZ: number) {
            return Math.floor(index / (shapeX * shapeY)) % shapeZ
        }

        this.updateMagneticX = this.gpu.createKernel(function (fieldY: number[], fieldZ: number[], permeability: number[], magFieldX: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Y Z - d_Z Y
            return getAt(magFieldX, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cellSize)) * (
                (getAt(fieldZ, gx, gy, gz, x, y + 1, z) - getAt(fieldZ, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])


        this.updateMagneticY = this.gpu.createKernel(function (fieldX: number[], fieldZ: number[], permeability: number[], magFieldY: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Z X - d_X Z
            return getAt(magFieldY, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cellSize)) * (
                -(getAt(fieldZ, gx, gy, gz, x + 1, y, z) - getAt(fieldZ, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])

        this.updateMagneticZ = this.gpu.createKernel(function (fieldX: number[], fieldY: number[], permeability: number[], magFieldZ: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_X Y - d_Y X
            return getAt(magFieldZ, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cellSize)) * (
                (getAt(fieldY, gx, gy, gz, x + 1, y, z) - getAt(fieldY, gx, gy, gz, x, y, z)) -
                (getAt(fieldX, gx, gy, gz, x, y + 1, z) - getAt(fieldX, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])

        this.updateElectricX = this.gpu.createKernel(function (fieldY: number[], fieldZ: number[], permittivity: number[], elFieldX: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Y Z - d_Z Y
            return getAt(elFieldX, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cellSize)) * (
                (getAt(fieldZ, gx, gy, gz, x, y, z) - getAt(fieldZ, gx, gy, gz, x, y - 1, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])

        this.updateElectricY = this.gpu.createKernel(function (fieldX: number[], fieldZ: number[], permittivity: number[], elFieldY: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Z X - d_X Z
            return getAt(elFieldY, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cellSize)) * (
                -(getAt(fieldZ, gx, gy, gz, x, y, z) - getAt(fieldZ, gx, gy, gz, x - 1, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])

        this.updateElectricZ = this.gpu.createKernel(function (fieldX: number[], fieldY: number[], permittivity: number[], elFieldZ: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cellSize = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_X Y - d_Y X
            return getAt(elFieldZ, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cellSize)) * (
                (getAt(fieldY, gx, gy, gz, x, y, z) - getAt(fieldY, gx, gy, gz, x - 1, y, z)) -
                (getAt(fieldX, gx, gy, gz, x, y, z) - getAt(fieldX, gx, gy, gz, x, y - 1, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt])
    }

    stepElectric = (dt: number) => {
        const elX = this.data.electricFieldX.values
        const elY = this.data.electricFieldY.values
        const elZ = this.data.electricFieldZ.values
        const magX = this.data.magneticFieldX.values
        const magY = this.data.magneticFieldY.values
        const magZ = this.data.magneticFieldZ.values
        const perm = this.data.permittivity.values

        // d/dt E(x, t) = (curl B(x, t))/(µε)
        this.data.electricFieldX.values = this.updateElectricX(magY, magZ, perm, elX, dt) as number[]
        this.data.electricFieldY.values = this.updateElectricY(magX, magZ, perm, elY, dt) as number[]
        this.data.electricFieldZ.values = this.updateElectricZ(magX, magY, perm, elZ, dt) as number[]

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        const elX = this.data.electricFieldX.values
        const elY = this.data.electricFieldY.values
        const elZ = this.data.electricFieldZ.values
        const magX = this.data.magneticFieldX.values
        const magY = this.data.magneticFieldY.values
        const magZ = this.data.magneticFieldZ.values
        const perm = this.data.permeability.values

        // d/dt B(x, t) = -curl E(x, t)
        this.data.magneticFieldX.values = this.updateMagneticX(elY, elZ, perm, magX, dt) as number[]
        this.data.magneticFieldY.values = this.updateMagneticY(elX, elZ, perm, magY, dt) as number[]
        this.data.magneticFieldZ.values = this.updateMagneticZ(elX, elY, perm, magZ, dt) as number[]

        this.data.time += dt / 2
    }

    getData = () => this.data
}