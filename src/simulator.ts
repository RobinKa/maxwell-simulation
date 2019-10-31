import { GPU, IKernelRunShortcut, Texture, KernelFunction } from "gpu.js"
import * as k from "./kernels/simulation"

export type MaterialType = "permittivity" | "permeability" | "conductivity"

export type DrawShapeType = "square" | "circle"

type BaseDrawInfo = {
    drawShape: DrawShapeType
    center: [number, number]
    value: number
}

type DrawSquareInfo = {
    drawShape: "square"
    halfSize: number
} & BaseDrawInfo

type DrawCircleInfo = {
    drawShape: "circle"
    radius: number
} & BaseDrawInfo

export function makeDrawSquareInfo(center: [number, number], halfSize: number, value: number): DrawSquareInfo {
    return {
        drawShape: "square",
        center,
        halfSize: halfSize,
        value
    }
}

export function makeDrawCircleInfo(center: [number, number], radius: number, value: number): DrawCircleInfo {
    return {
        drawShape: "circle",
        center,
        radius,
        value
    }
}

export type DrawInfo = DrawSquareInfo | DrawCircleInfo

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
    conductivity: ScalarField2D

    electricSourceFieldZ: ScalarField2D
}

function getFieldByMaterialType(simulationData: SimulationData, materialType: MaterialType) {
    switch (materialType) {
        case "permittivity":
            return simulationData.permittivity
        case "permeability":
            return simulationData.permeability
        case "conductivity":
            return simulationData.conductivity
    }

    throw new Error("Unhandled material type: " + materialType)
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    resetFields: () => void
    resetMaterials: () => void
    injectSignal: (drawInfo: DrawInfo, dt: number) => void
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
    private copyTextureWithBounds: (name: string) => IKernelRunShortcut

    private drawOnTexture: { [shape: string]: (name: string) => IKernelRunShortcut }

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
        this.copyTextureWithBounds = memoByName(() => makeKernel(k.copyTextureWithBounds))

        const makeField = (name: string, initialValue: number): ScalarField2D => { return { values: this.makeFieldTexture(name)(initialValue) as Texture, shape: this.gridSize } }

        this.data = {
            time: 0,
            electricField: [0, 1, 2].map(i => makeField(`e${i}`, 0)) as [ScalarField2D, ScalarField2D, ScalarField2D],
            magneticField: [0, 1, 2].map(i => makeField(`m${i}`, 0)) as [ScalarField2D, ScalarField2D, ScalarField2D],
            electricSourceFieldZ: makeField("es2", 0),
            permittivity: makeField("permittivity", 1),
            permeability: makeField("permeability", 1),
            conductivity: makeField("conductivity", 0)
        }

        this.drawOnTexture = {
            "square": memoByName(() => makeKernelWithFuncsAndConsts(k.drawSquare)),
            "circle": memoByName(() => makeKernelWithFuncsAndConsts(k.drawCircle))
        }

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

        const oldShape = this.data.permittivity.shape

        this.data.permittivity.shape = gridSize
        this.data.permeability.shape = gridSize
        this.data.conductivity.shape = gridSize

        this.data.permittivity.values = this.copyTextureWithBounds("permittivity")(this.data.permittivity.values, oldShape, 1) as Texture
        this.data.permeability.values = this.copyTextureWithBounds("permeability")(this.data.permeability.values, oldShape, 1) as Texture
        this.data.conductivity.values = this.copyTextureWithBounds("conductivity")(this.data.conductivity.values, oldShape, 0) as Texture

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
        const cond = this.data.conductivity.values

        const injectedElZ = this.injectSource(this.data.electricSourceFieldZ.values, el[2], dt) as Texture
        this.data.electricSourceFieldZ.values = this.decaySource(this.copyTexture("es2")(this.data.electricSourceFieldZ.values), dt) as Texture

        // d/dt E(x, t) = curl B(x, t) / ε
        this.data.electricField[0].values = this.updateElectric[0](mag[2], perm, cond, this.copyTexture("e0")(el[0]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricField[1].values = this.updateElectric[1](mag[2], perm, cond, this.copyTexture("e1")(el[1]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.electricField[2].values = this.updateElectric[2](mag[0], mag[1], perm, cond, injectedElZ, dt, this.cellSize, this.reflectiveBoundary) as Texture

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        const el = this.data.electricField.map(f => f.values)
        const mag = this.data.magneticField.map(f => f.values)
        const perm = this.data.permeability.values
        const cond = this.data.conductivity.values

        // d/dt B(x, t) = -curl E(x, t) / µ
        this.data.magneticField[0].values = this.updateMagnetic[0](el[2], perm, cond, this.copyTexture("m0")(mag[0]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticField[1].values = this.updateMagnetic[1](el[2], perm, cond, this.copyTexture("m1")(mag[1]), dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.magneticField[2].values = this.updateMagnetic[2](el[0], el[1], perm, cond, this.copyTexture("m2")(mag[2]), dt, this.cellSize, this.reflectiveBoundary) as Texture

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
        this.data.conductivity.values = this.makeFieldTexture("conductivity")(0) as Texture
    }

    private drawShape = (field: ScalarField2D, fieldName: string, drawInfo: DrawInfo, keep: number) => {
        const drawFunc = this.drawOnTexture[drawInfo.drawShape](fieldName)
        const copiedValues = this.copyTexture(fieldName)(field.values)

        switch (drawInfo.drawShape) {
            case "square":
                field.values = drawFunc(drawInfo.center, drawInfo.halfSize, drawInfo.value, keep, copiedValues) as Texture
                break
            case "circle":
                field.values = drawFunc(drawInfo.center, drawInfo.radius, drawInfo.value, keep, copiedValues) as Texture
                break
            default:
                throw Error(`Invalid draw shape: ${JSON.stringify(drawInfo)}`)
        }
    }

    drawMaterial = (materialType: MaterialType, drawInfo: DrawInfo) => {
        const materialField = getFieldByMaterialType(this.data, materialType)
        this.drawShape(materialField, materialType, drawInfo, 0)
    }

    injectSignal = (drawInfo: DrawInfo, dt: number) => {
        this.drawShape(this.data.electricSourceFieldZ, "es2", { ...drawInfo, value: drawInfo.value * dt }, 1)
    }

    loadPermittivity = (permittivity: number[][]) => {
        this.data.permittivity.values = this.copyTextureWithBounds("loadPermittivity")(permittivity, [permittivity[0].length, permittivity.length], 1) as Texture
    }

    loadPermeability = (permeability: number[][]) => {
        this.data.permeability.values = this.copyTextureWithBounds("loadPermeability")(permeability, [permeability[0].length, permeability.length], 1) as Texture
    }

    loadConductivity = (conductivity: number[][]) => {
        this.data.conductivity.values = this.copyTextureWithBounds("loadConductivity")(conductivity, [conductivity[0].length, conductivity.length], 0) as Texture
    }

    getData = () => this.data
}