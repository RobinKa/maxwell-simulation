import { GPU, IKernelRunShortcut, Texture } from "gpu.js"

export type FlatScalarField3D = {
    values: Texture
    shape: [number, number]
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

function memoByName<T>(makeNew: () => T) {
    const memoized: { [name: string]: T } = {}

    return (name: string) => {
        if (!memoized[name]) {
            memoized[name] = makeNew()
        }
        return memoized[name]
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

    constructor(readonly gpu: GPU, readonly gridSize: [number, number], readonly cellSize: number) {
        this.makeFieldTexture = memoByName(() => this.gpu.createKernel(function (value: number) {
            return value
        }).setOutput([gridSize[0], gridSize[1]]).setPipeline(true).setTactic("performance"))

        this.copyTexture = memoByName(() => this.gpu.createKernel(function (texture: number[][]) {
            return texture[this.thread.y!][this.thread.x]
        }).setOutput([gridSize[0], gridSize[1]]).setPipeline(true).setTactic("performance"))

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

        function getAt(field: number[][], shapeX: number, shapeY: number, x: number, y: number) {
            if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
                return 0
            }

            return field[y][x]
        }

        this.drawOnTexture = memoByName(() => this.gpu.createKernel(function (pos: number[], size: number, value: number, keep: number, texture: number[][]) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number

            const oldValue = getAt(texture, gx, gy, x, y)

            const within = Math.max(Math.abs(pos[0] - x), Math.abs(pos[1] - y)) < size

            return within ? value + keep * oldValue : oldValue
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance"))

        this.injectSource = this.gpu.createKernel(function (source: number[][], field: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number

            return getAt(field, gx, gy, x, y) + getAt(source, gx, gy, x, y) * dt
        }, {
            output: [gridSize[0], gridSize[1]],
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.decaySource = this.gpu.createKernel(function (source: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number

            return getAt(source, gx, gy, x, y) * Math.pow(0.1, dt)
        }, {
            output: [gridSize[0], gridSize[1]],
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateMagneticX = this.gpu.createKernel(function (fieldY: number[][], fieldZ: number[][], permeability: number[][], magFieldX: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_Y Z - d_Z Y
            return getAt(magFieldX, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
                (getAt(fieldZ, gx, gy, x, y + 1) - getAt(fieldZ, gx, gy, x, y)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateMagneticY = this.gpu.createKernel(function (fieldX: number[][], fieldZ: number[][], permeability: number[][], magFieldY: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_Z X - d_X Z
            return getAt(magFieldY, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
                -(getAt(fieldZ, gx, gy, x + 1, y) - getAt(fieldZ, gx, gy, x, y)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateMagneticZ = this.gpu.createKernel(function (fieldX: number[][], fieldY: number[][], permeability: number[][], magFieldZ: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_X Y - d_Y X
            return getAt(magFieldZ, gx, gy, x, y) - (dt / (getAt(permeability, gx, gy, x, y) * cs)) * (
                (getAt(fieldY, gx, gy, x + 1, y) - getAt(fieldY, gx, gy, x, y)) -
                (getAt(fieldX, gx, gy, x, y + 1) - getAt(fieldX, gx, gy, x, y)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateElectricX = this.gpu.createKernel(function (fieldY: number[][], fieldZ: number[][], permittivity: number[][], elFieldX: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_Y Z - d_Z Y
            return getAt(elFieldX, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
                (getAt(fieldZ, gx, gy, x, y) - getAt(fieldZ, gx, gy, x, y - 1)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateElectricY = this.gpu.createKernel(function (fieldX: number[][], fieldZ: number[][], permittivity: number[][], elFieldY: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_Z X - d_X Z
            return getAt(elFieldY, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
                -(getAt(fieldZ, gx, gy, x, y) - getAt(fieldZ, gx, gy, x - 1, y)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")

        this.updateElectricZ = this.gpu.createKernel(function (fieldX: number[][], fieldY: number[][], permittivity: number[][], elFieldZ: number[][], dt: number) {
            const x = this.thread.x as number
            const y = this.thread.y! as number
            const gx = this.output.x as number
            const gy = this.output.y as number
            const cs = this.constants.cellSize as number

            // d_X Y - d_Y X
            return getAt(elFieldZ, gx, gy, x, y) + (dt / (getAt(permittivity, gx, gy, x, y) * cs)) * (
                (getAt(fieldY, gx, gy, x, y) - getAt(fieldY, gx, gy, x - 1, y)) -
                (getAt(fieldX, gx, gy, x, y) - getAt(fieldX, gx, gy, x, y - 1)))
        }, {
            output: [gridSize[0], gridSize[1]],
            constants: { cellSize: cellSize },
        }).setFunctions([getAt]).setWarnVarUsage(false).setPipeline(true).setTactic("performance")
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
    
    loadPermittivity = (permittivity: number[][]) => {
        this.data.permittivity.values = this.copyTexture("loadPermittivity")(permittivity) as Texture
    }

    loadPermeability = (permeability: number[][]) => {
        this.data.permeability.values = this.copyTexture("loadPermeability")(permeability) as Texture
    }

    getData = () => this.data
}