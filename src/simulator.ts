import { GPU, IKernelRunShortcut, Texture, KernelFunction } from "gpu.js"
import * as k from "./kernels/simulation"

export type ScalarField2D = {
    values: Texture
    shape: [number, number]
}

export type SimulationData = {
    time: number
    electricField: [ScalarField2D, ScalarField2D, ScalarField2D]
    magneticField: [ScalarField2D, ScalarField2D, ScalarField2D]

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

    private updateMagnetic: [IKernelRunShortcut, IKernelRunShortcut, IKernelRunShortcut]
    private updateElectric: [IKernelRunShortcut, IKernelRunShortcut, IKernelRunShortcut]

    private injectSource: IKernelRunShortcut
    private decaySource: IKernelRunShortcut

    private makeFieldTexture: (name: string) => IKernelRunShortcut
    private copyTexture: (name: string) => IKernelRunShortcut

    private drawOnTexture: (name: string) => IKernelRunShortcut

    private kernels: IKernelRunShortcut[] = []

    constructor(readonly gpu: GPU, private gridSize: [number, number], private cellSize: number, public reflectiveBoundary: boolean) {
        const makeKernel = (kernel: KernelFunction) => {
            const runKernel = this.gpu.createKernel(kernel).setOutput(this.gridSize).setWarnVarUsage(false)
                .setPipeline(true).setTactic("performance").setDynamicOutput(true).setDynamicArguments(true).setPrecision("single")
            this.kernels.push(runKernel)
            return runKernel
        }
        const makeKernelWithFuncs = (kernel: KernelFunction) => makeKernel(kernel).setFunctions([k.getAt])
        const makeKernelWithFuncsAndConsts = (kernel: KernelFunction) => makeKernelWithFuncs(kernel).setConstants({ cellSize: cellSize })

        this.makeFieldTexture = memoByName(() => makeKernel(k.makeFieldTexture))
        this.copyTexture = memoByName(() => makeKernel(k.copyTexture))

        const makeField = (name: string, initialValue: number): ScalarField2D => { return { values: this.makeFieldTexture(name)(initialValue) as Texture, shape: this.gridSize } }

        this.data = {
            time: 0,
            electricField: [0, 1, 2].map(i => makeField(`e${i}`, 0)) as [ScalarField2D, ScalarField2D, ScalarField2D],
            magneticField: [0, 1, 2].map(i => makeField(`m${i}`, 0)) as [ScalarField2D, ScalarField2D, ScalarField2D],
            electricSourceFieldZ: makeField("es2", 0),
            permittivity: makeField("permittivity", 1),
            permeability: makeField("permeability", 1)
        }

        this.drawOnTexture = memoByName(() => makeKernelWithFuncsAndConsts(k.drawOnTexture))
        this.injectSource = makeKernelWithFuncs(k.injectSource)
        this.decaySource = makeKernelWithFuncs(k.decaySource)

        this.updateMagnetic = [
            makeKernelWithFuncsAndConsts(k.updateMagneticX),
            makeKernelWithFuncsAndConsts(k.updateMagneticY),
            makeKernelWithFuncsAndConsts(k.updateMagneticZ)
        ]

        this.updateElectric = [
            makeKernelWithFuncsAndConsts(k.updateElectricX),
            makeKernelWithFuncsAndConsts(k.updateElectricY),
            makeKernelWithFuncsAndConsts(k.updateElectricZ)
        ]
    }

    setGridSize = (gridSize: [number, number]) => {
        this.gridSize = gridSize

        this.kernels.forEach(kernel => kernel.setOutput(gridSize))

        for (let dim = 0; dim < 3; dim++) {
            this.data.electricField[dim].shape = gridSize
            this.data.magneticField[dim].shape = gridSize
        }

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
        const el = this.data.electricField.map(f => f.values)
        const mag = this.data.magneticField.map(f => f.values)
        const perm = this.data.permittivity.values

        const injectedElZ = this.injectSource(this.data.electricSourceFieldZ.values, el[2], dt) as Texture
        this.data.electricSourceFieldZ.values = this.decaySource(this.copyTexture("es2")(this.data.electricSourceFieldZ.values), dt) as Texture

        // d/dt E(x, t) = curl B(x, t) / ε
        this.data.electricField[0].values = this.updateElectric[0](mag[1], mag[2], perm, this.copyTexture("e0")(el[0]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricField[1].values = this.updateElectric[1](mag[0], mag[2], perm, this.copyTexture("e1")(el[1]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricField[2].values = this.updateElectric[2](mag[0], mag[1], perm, injectedElZ, dt, this.cellSize, this.reflectiveBoundary) as Texture

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        const el = this.data.electricField.map(f => f.values)
        const mag = this.data.magneticField.map(f => f.values)
        const perm = this.data.permeability.values

        // d/dt B(x, t) = -curl E(x, t) / µ
        this.data.magneticField[0].values = this.updateMagnetic[0](el[1], el[2], perm, this.copyTexture("m0")(mag[0]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticField[1].values = this.updateMagnetic[1](el[0], el[2], perm, this.copyTexture("m1")(mag[1]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticField[2].values = this.updateMagnetic[2](el[0], el[1], perm, this.copyTexture("m2")(mag[2]), dt, this.cellSize, this.reflectiveBoundary) as Texture

        this.data.time += dt / 2
    }

    resetFields = () => {
        this.data.time = 0

        for (let dim = 0; dim < 3; dim++) {
            this.data.electricField[dim].values = this.makeFieldTexture(`e${dim}`)(0) as Texture
            this.data.magneticField[dim].values = this.makeFieldTexture(`m${dim}`)(0) as Texture
        }

        this.data.electricSourceFieldZ.values = this.makeFieldTexture("es2")(0) as Texture
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
        this.data.electricSourceFieldZ.values = this.drawOnTexture("es2")(pos, size, value * dt, 1, this.copyTexture("es2")(this.data.electricSourceFieldZ.values)) as Texture
    }

    loadPermittivity = (permittivity: number[][]) => {
        this.data.permittivity.values = this.copyTexture("loadPermittivity")(permittivity) as Texture
    }

    loadPermeability = (permeability: number[][]) => {
        this.data.permeability.values = this.copyTexture("loadPermeability")(permeability) as Texture
    }

    getData = () => this.data
}