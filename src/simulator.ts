import { GPU, IKernelRunShortcut, Texture, KernelFunction } from "gpu.js"
import * as k from "./kernels/simulation"
import { getAt } from "./kernels/simulation"

export type ScalarField2D = {
    values: Texture
    shape: [number, number]
}

export type SimulationData = {
    time: number
    electricFieldX: ScalarField2D
    electricFieldY: ScalarField2D
    electricFieldZ: ScalarField2D
    magneticFieldX: ScalarField2D
    magneticFieldY: ScalarField2D
    magneticFieldZ: ScalarField2D

    permittivity: ScalarField2D
    permeability: ScalarField2D

    electricSourceFieldZ: ScalarField2D
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    resetFields: () => void
    resetMaterials: () => void
    injectSignal: (pos: [number, number], size: number, value: number, dt: number) => void
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

    private kernels: IKernelRunShortcut[] = []

    constructor(readonly gpu: GPU, private gridSize: [number, number], private cellSize: number, public reflectiveBoundary: boolean) {
        const makeKernel = (kernel: KernelFunction) => {
            const runKernel = this.gpu.createKernel(kernel).setOutput(this.gridSize).setWarnVarUsage(false).setPipeline(true).setTactic("performance").setDynamicOutput(true).setDynamicArguments(true).setPrecision("single")
            this.kernels.push(runKernel)
            return runKernel
        }
        const makeKernelWithFuncs = (kernel: KernelFunction) => makeKernel(kernel).setFunctions([getAt])
        const makeKernelWithFuncsAndConsts = (kernel: KernelFunction) => makeKernelWithFuncs(kernel).setConstants({ cellSize: cellSize })

        this.makeFieldTexture = memoByName(() => makeKernel(k.makeFieldTexture))
        this.copyTexture = memoByName(() => makeKernel(k.copyTexture))

        this.data = {
            time: 0,
            electricFieldX: { values: this.makeFieldTexture("ex")(0) as Texture, shape: this.gridSize },
            electricFieldY: { values: this.makeFieldTexture("ey")(0) as Texture, shape: this.gridSize },
            electricFieldZ: { values: this.makeFieldTexture("ez")(0) as Texture, shape: this.gridSize },
            magneticFieldX: { values: this.makeFieldTexture("mx")(0) as Texture, shape: this.gridSize },
            magneticFieldY: { values: this.makeFieldTexture("my")(0) as Texture, shape: this.gridSize },
            magneticFieldZ: { values: this.makeFieldTexture("mz")(0) as Texture, shape: this.gridSize },
            electricSourceFieldZ: { values: this.makeFieldTexture("esz")(0) as Texture, shape: this.gridSize },
            permittivity: { values: this.makeFieldTexture("permittivity")(1) as Texture, shape: this.gridSize },
            permeability: { values: this.makeFieldTexture("permeability")(1) as Texture, shape: this.gridSize },
        }

        this.drawOnTexture = memoByName(() => makeKernelWithFuncsAndConsts(k.drawOnTexture))
        this.injectSource = makeKernelWithFuncs(k.injectSource)
        this.decaySource = makeKernelWithFuncs(k.decaySource)
        this.updateMagneticX = makeKernelWithFuncsAndConsts(k.updateMagneticX)
        this.updateMagneticY = makeKernelWithFuncsAndConsts(k.updateMagneticY)
        this.updateMagneticZ = makeKernelWithFuncsAndConsts(k.updateMagneticZ)
        this.updateElectricX = makeKernelWithFuncsAndConsts(k.updateMagneticX)
        this.updateElectricY = makeKernelWithFuncsAndConsts(k.updateElectricY)
        this.updateElectricZ = makeKernelWithFuncsAndConsts(k.updateElectricZ)
    }

    setGridSize = (gridSize: [number, number]) => {
        this.gridSize = gridSize

        this.kernels.forEach(kernel => kernel.setOutput(gridSize))

        this.data.electricFieldX.shape = gridSize
        this.data.electricFieldY.shape = gridSize
        this.data.electricFieldZ.shape = gridSize
        this.data.magneticFieldX.shape = gridSize
        this.data.magneticFieldY.shape = gridSize
        this.data.magneticFieldZ.shape = gridSize
        this.data.permittivity.shape = gridSize
        this.data.permeability.shape = gridSize

        // TODO: Copy only the valid fraction. This one will potentially copy out of bounds.
        this.data.permittivity.values = this.copyTexture("permittivity")(this.data.permittivity.values) as Texture
        this.data.permeability.values = this.copyTexture("permeability")(this.data.permeability.values) as Texture

        this.resetFields()
    }

    setCellSize = (cellSize: number) => {
        this.cellSize = cellSize

        this.resetFields()
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
        this.data.electricFieldX.values = this.updateElectricX(magY, magZ, perm, this.copyTexture("ex")(elX), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricFieldY.values = this.updateElectricY(magX, magZ, perm, this.copyTexture("ey")(elY), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricFieldZ.values = this.updateElectricZ(magX, magY, perm, injectedElZ, dt, this.cellSize, this.reflectiveBoundary) as Texture

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
        this.data.magneticFieldX.values = this.updateMagneticX(elY, elZ, perm, this.copyTexture("mx")(magX), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticFieldY.values = this.updateMagneticY(elX, elZ, perm, this.copyTexture("my")(magY), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticFieldZ.values = this.updateMagneticZ(elX, elY, perm, this.copyTexture("mz")(magZ), dt, this.cellSize, this.reflectiveBoundary) as Texture

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

    injectSignal = (pos: [number, number], size: number, value: number, dt: number) => {
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