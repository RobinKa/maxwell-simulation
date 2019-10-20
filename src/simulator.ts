import { GPU, IKernelRunShortcut, Texture } from "gpu.js"

export type FlatScalarField3D = {
    values: Texture
    shape: [number, number, number]
}

export function indexToCoords(index: number, shape: [number, number, number]): [number, number, number] {
    return [index % shape[0], Math.floor(index / shape[0]) % shape[1], Math.floor(index / (shape[0] * shape[1])) % shape[2]]
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

    electricSourceFieldZ: FlatScalarField3D
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    resetFields: () => void
    resetMaterials: () => void
    getData: () => SimulationData
}

function memoKernelFunc(makeFunc: () => IKernelRunShortcut) {
    const funcs: { [name: string]: IKernelRunShortcut } = {}

    return (name: string) => {
        if (!funcs[name]) {
            funcs[name] = makeFunc()
        }
        return funcs[name]
    }
}

export class FDTDSimulator implements Simulator {
    private data: SimulationData

    private updateMagneticX: IKernelRunShortcut
    private updateMagneticY: IKernelRunShortcut
    private updateMagneticZ: IKernelRunShortcut
    private updateElectricX: IKernelRunShortcut
    private updateElectricY: IKernelRunShortcut
    private updateElectricZ: IKernelRunShortcut

    private injectSource: IKernelRunShortcut
    private decaySource: IKernelRunShortcut

    private makeFieldTexture: (name: string) => IKernelRunShortcut
    private copyTexture: (name: string) => IKernelRunShortcut

    private drawOnTexture: (name: string) => IKernelRunShortcut

    constructor(readonly gpu: GPU, readonly gridSize: [number, number, number], readonly cellSize: number) {
        const cellCount = gridSize[0] * gridSize[1] * gridSize[2]

        this.makeFieldTexture = memoKernelFunc(() => this.gpu.createKernel(function (value: number) {
            return value
        }).setOutput([cellCount]).setPipeline(true))

        this.copyTexture = memoKernelFunc(() => this.gpu.createKernel(function (texture: number[]) {
            return texture[this.thread.x]
        }).setOutput([cellCount]).setPipeline(true))

        this.data = {
            time: 0,
            electricFieldX: { values: this.makeFieldTexture("ex")(0) as Texture, shape: gridSize },
            electricFieldY: { values: this.makeFieldTexture("ey")(0) as Texture, shape: gridSize },
            electricFieldZ: { values: this.makeFieldTexture("ez")(0) as Texture, shape: gridSize },
            magneticFieldX: { values: this.makeFieldTexture("mx")(0) as Texture, shape: gridSize },
            magneticFieldY: { values: this.makeFieldTexture("my")(0) as Texture, shape: gridSize },
            magneticFieldZ: { values: this.makeFieldTexture("mz")(0) as Texture, shape: gridSize },
            electricSourceFieldZ: { values: this.makeFieldTexture("esz")(0) as Texture, shape: gridSize },
            permittivity: { values: this.makeFieldTexture("permittivity")(1) as Texture, shape: gridSize },
            permeability: { values: this.makeFieldTexture("permeability")(1) as Texture, shape: gridSize },
        }

        function getAt(field: number[], shapeX: number, shapeY: number, shapeZ: number, x: number, y: number, z: number) {
            if (x < 0 || x >= shapeX || y < 0 || y >= shapeY || z < 0 || z >= shapeZ) {
                return 0
            }

            return field[x + y * shapeX + z * shapeX * shapeY]
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

        this.drawOnTexture = memoKernelFunc(() => this.gpu.createKernel(function (pos: number[], size: number, value: number, keep: number, texture: number[]) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            const oldValue = getAt(texture, gx, gy, gz, x, y, z)

            const within = Math.max(Math.abs(pos[0] - x), Math.max(Math.abs(pos[1] - y), Math.abs(pos[2] - z))) < size

            return within ? value + keep * oldValue : oldValue
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] },
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true))

        this.injectSource = this.gpu.createKernel(function (source: number[], field: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            return getAt(field, gx, gy, gz, x, y, z) + getAt(source, gx, gy, gz, x, y, z) * dt
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] },
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.decaySource = this.gpu.createKernel(function (source: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            return getAt(source, gx, gy, gz, x, y, z) * Math.pow(0.1, dt)
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] },
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateMagneticX = this.gpu.createKernel(function (fieldY: number[], fieldZ: number[], permeability: number[], magFieldX: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Y Z - d_Z Y
            return getAt(magFieldX, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cs)) * (
                (getAt(fieldZ, gx, gy, gz, x, y + 1, z) - getAt(fieldZ, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] },
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateMagneticY = this.gpu.createKernel(function (fieldX: number[], fieldZ: number[], permeability: number[], magFieldY: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Z X - d_X Z
            return getAt(magFieldY, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cs)) * (
                -(getAt(fieldZ, gx, gy, gz, x + 1, y, z) - getAt(fieldZ, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateMagneticZ = this.gpu.createKernel(function (fieldX: number[], fieldY: number[], permeability: number[], magFieldZ: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_X Y - d_Y X
            return getAt(magFieldZ, gx, gy, gz, x, y, z) - (dt / (getAt(permeability, gx, gy, gz, x, y, z) * cs)) * (
                (getAt(fieldY, gx, gy, gz, x + 1, y, z) - getAt(fieldY, gx, gy, gz, x, y, z)) -
                (getAt(fieldX, gx, gy, gz, x, y + 1, z) - getAt(fieldX, gx, gy, gz, x, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateElectricX = this.gpu.createKernel(function (fieldY: number[], fieldZ: number[], permittivity: number[], elFieldX: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Y Z - d_Z Y
            return getAt(elFieldX, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cs)) * (
                (getAt(fieldZ, gx, gy, gz, x, y, z) - getAt(fieldZ, gx, gy, gz, x, y - 1, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateElectricY = this.gpu.createKernel(function (fieldX: number[], fieldZ: number[], permittivity: number[], elFieldY: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_Z X - d_X Z
            return getAt(elFieldY, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cs)) * (
                -(getAt(fieldZ, gx, gy, gz, x, y, z) - getAt(fieldZ, gx, gy, gz, x - 1, y, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)

        this.updateElectricZ = this.gpu.createKernel(function (fieldX: number[], fieldY: number[], permittivity: number[], elFieldZ: number[], dt: number) {
            const index = Math.floor(this.thread.x)

            const gx = this.constants.gridSizeX as number
            const gy = this.constants.gridSizeY as number
            const gz = this.constants.gridSizeZ as number
            const cs = this.constants.cellSize as number

            const x = getX(index, gx)
            const y = getY(index, gx, gy)
            const z = getZ(index, gx, gy, gz)

            // d_X Y - d_Y X
            return getAt(elFieldZ, gx, gy, gz, x, y, z) + (dt / (getAt(permittivity, gx, gy, gz, x, y, z) * cs)) * (
                (getAt(fieldY, gx, gy, gz, x, y, z) - getAt(fieldY, gx, gy, gz, x - 1, y, z)) -
                (getAt(fieldX, gx, gy, gz, x, y, z) - getAt(fieldX, gx, gy, gz, x, y - 1, z)))
        }, {
            output: [cellCount],
            constants: { cellSize: cellSize, gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }
        }).setFunctions([getX, getY, getZ, getAt]).setWarnVarUsage(false).setPipeline(true)
    }

    stepElectric = (dt: number) => {
        const elX = this.data.electricFieldX.values
        const elY = this.data.electricFieldY.values
        const elZ = this.data.electricFieldZ.values
        const magX = this.data.magneticFieldX.values
        const magY = this.data.magneticFieldY.values
        const magZ = this.data.magneticFieldZ.values
        const perm = this.data.permittivity.values

        const injectedElZ = this.injectSource(this.data.electricSourceFieldZ.values, elZ, dt) as Texture
        this.data.electricSourceFieldZ.values = this.decaySource(this.copyTexture("esz")(this.data.electricSourceFieldZ.values), dt) as Texture

        // d/dt E(x, t) = (curl B(x, t))/(µε)
        this.data.electricFieldX.values = this.updateElectricX(magY, magZ, perm, this.copyTexture("ex")(elX), dt) as Texture
        this.data.electricFieldY.values = this.updateElectricY(magX, magZ, perm, this.copyTexture("ey")(elY), dt) as Texture
        this.data.electricFieldZ.values = this.updateElectricZ(magX, magY, perm, injectedElZ, dt) as Texture

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
        this.data.magneticFieldX.values = this.updateMagneticX(elY, elZ, perm, this.copyTexture("mx")(magX), dt) as Texture
        this.data.magneticFieldY.values = this.updateMagneticY(elX, elZ, perm, this.copyTexture("my")(magY), dt) as Texture
        this.data.magneticFieldZ.values = this.updateMagneticZ(elX, elY, perm, this.copyTexture("mz")(magZ), dt) as Texture

        this.data.time += dt / 2
    }

    resetFields = () => {
        this.data.time = 0
        this.data.electricFieldX.values = this.makeFieldTexture("ex")(0) as Texture
        this.data.electricFieldY.values = this.makeFieldTexture("ey")(0) as Texture
        this.data.electricFieldZ.values = this.makeFieldTexture("ez")(0) as Texture
        this.data.magneticFieldX.values = this.makeFieldTexture("mx")(0) as Texture
        this.data.magneticFieldY.values = this.makeFieldTexture("my")(0) as Texture
        this.data.magneticFieldZ.values = this.makeFieldTexture("mz")(0) as Texture
        this.data.electricSourceFieldZ.values = this.makeFieldTexture("esz")(0) as Texture
    }

    resetMaterials = () => {
        this.data.permeability.values = this.makeFieldTexture("permeability")(1) as Texture
        this.data.permittivity.values = this.makeFieldTexture("permittivity")(1) as Texture
    }

    drawPermeability = (pos: [number, number, number], size: number, value: number) => {
        this.data.permeability.values = this.drawOnTexture("permeability")(pos, size, value, 0, this.copyTexture("permability")(this.data.permeability.values)) as Texture
    }

    drawPermittivity = (pos: [number, number, number], size: number, value: number) => {
        this.data.permittivity.values = this.drawOnTexture("permittivity")(pos, size, value, 0, this.copyTexture("permittivity")(this.data.permittivity.values)) as Texture
    }

    injectSignal = (pos: [number, number, number], size: number, value: number, dt: number) => {
        this.data.electricSourceFieldZ.values = this.drawOnTexture("esz")(pos, size, value * dt, 1, this.copyTexture("esz")(this.data.electricSourceFieldZ.values)) as Texture
    }

    getData = () => this.data
}