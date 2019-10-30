import { GPU, IKernelRunShortcut, Texture, KernelFunction } from "gpu.js"
import * as k from "./kernels/simulation"

export type MaterialType = "permittivity" | "permeability"

export type DrawShapeType = "square" | "circle"

type BaseDrawInfo = {
    drawShape: DrawShapeType
    center: [number, number]
    value: number[]
}

type DrawSquareInfo = {
    drawShape: "square"
    halfSize: number
} & BaseDrawInfo

type DrawCircleInfo = {
    drawShape: "circle"
    radius: number
} & BaseDrawInfo

export function makeDrawSquareInfo(center: [number, number], halfSize: number, value: number[]): DrawSquareInfo {
    return {
        drawShape: "square",
        center,
        halfSize: halfSize,
        value
    }
}

export function makeDrawCircleInfo(center: [number, number], radius: number, value: number[]): DrawCircleInfo {
    return {
        drawShape: "circle",
        center,
        radius,
        value
    }
}

export type DrawInfo = DrawSquareInfo | DrawCircleInfo

export type VectorField2D = {
    values: Texture
    shape: [number, number, number]
}

export type SimulationData = {
    time: number

    electricField: VectorField2D
    magneticField: VectorField2D

    permittivity: VectorField2D
    permeability: VectorField2D

    electricSourceField: VectorField2D
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

    private updateElectric: IKernelRunShortcut
    private updateMagnetic: IKernelRunShortcut

    private injectSource: IKernelRunShortcut
    private decaySource: IKernelRunShortcut

    private makeMaterialTexture: (name: string) => IKernelRunShortcut
    private makeFieldTexture: (name: string) => IKernelRunShortcut
    private copyMaterialTexture: (name: string) => IKernelRunShortcut
    private copyFieldTexture: (name: string) => IKernelRunShortcut
    private copyMaterialTextureWithBounds: (name: string) => IKernelRunShortcut

    private drawOnMaterial: { [shape: string]: (name: string) => IKernelRunShortcut }
    private drawOnField: { [shape: string]: (name: string) => IKernelRunShortcut }

    private kernels: IKernelRunShortcut[] = []

    constructor(readonly gpu: GPU, private gridSize: [number, number], private cellSize: number, public reflectiveBoundary: boolean) {
        const makeKernel = (kernel: KernelFunction, depth: number) => {
            const runKernel = this.gpu.createKernel(kernel).setOutput([this.gridSize[0], this.gridSize[1], depth]).setWarnVarUsage(false)
                .setPipeline(true).setTactic("performance").setDynamicOutput(true).setDynamicArguments(true).setPrecision("single")
            this.kernels.push(runKernel)
            return runKernel
        }
        const makeKernelWithFuncs = (kernel: KernelFunction, depth: number) => makeKernel(kernel, depth).setFunctions([k.getAt])
        const makeKernelWithFuncsAndConsts = (kernel: KernelFunction, depth: number) => makeKernelWithFuncs(kernel, depth).setConstants({ cellSize: cellSize })

        this.makeMaterialTexture = memoByName(() => makeKernel(k.makeFieldTexture, 2))
        this.makeFieldTexture = memoByName(() => makeKernel(k.makeFieldTexture, 6))
        this.copyMaterialTexture = memoByName(() => makeKernel(k.copyTexture, 2))
        this.copyFieldTexture = memoByName(() => makeKernel(k.copyTexture, 6))
        this.copyMaterialTextureWithBounds = memoByName(() => makeKernel(k.copyTextureWithBounds, 2))

        const makeField = (name: string): VectorField2D => { return { values: this.makeFieldTexture(name)([0, 0, 0, 0, 0, 0]) as Texture, shape: [this.gridSize[0], this.gridSize[1], 6] } }
        const makeMaterial = (name: string): VectorField2D => { return { values: this.makeMaterialTexture(name)([1, 0]) as Texture, shape: [this.gridSize[0], this.gridSize[1], 2] } }

        this.data = {
            time: 0,
            electricField: makeField("e"),
            magneticField: makeField("m"),
            electricSourceField: makeField("es"),
            permittivity: makeMaterial("permittivity"),
            permeability: makeMaterial("permeability"),
        }

        this.drawOnField = {
            "square": memoByName(() => makeKernelWithFuncsAndConsts(k.drawSquare, 6)),
            "circle": memoByName(() => makeKernelWithFuncsAndConsts(k.drawCircle, 6))
        }

        this.drawOnMaterial = {
            "square": memoByName(() => makeKernelWithFuncsAndConsts(k.drawSquare, 2)),
            "circle": memoByName(() => makeKernelWithFuncsAndConsts(k.drawCircle, 2))
        }

        this.injectSource = makeKernelWithFuncs(k.injectSource, 6)
        this.decaySource = makeKernelWithFuncs(k.decaySource, 6)

        this.updateMagnetic = makeKernelWithFuncsAndConsts(k.updateMagnetic, 6)
        this.updateElectric = makeKernelWithFuncsAndConsts(k.updateElectric, 6)
    }

    setGridSize = (gridSize: [number, number]) => {
        this.gridSize = gridSize

        this.kernels.forEach(kernel => kernel.setOutput(gridSize))

        this.data.electricField.shape[0] = gridSize[0]
        this.data.electricField.shape[1] = gridSize[1]
        this.data.magneticField.shape[0] = gridSize[0]
        this.data.magneticField.shape[1] = gridSize[1]

        const oldGridSize = [this.data.permittivity.shape[0], this.data.permittivity.shape[1]]

        this.data.permittivity.shape[0] = gridSize[0]
        this.data.permittivity.shape[1] = gridSize[1]
        this.data.permeability.shape[0] = gridSize[0]
        this.data.permeability.shape[1] = gridSize[1]

        this.data.permittivity.values = this.copyMaterialTextureWithBounds("permittivity")(this.data.permittivity.values, oldGridSize, 1) as Texture
        this.data.permeability.values = this.copyMaterialTextureWithBounds("permeability")(this.data.permeability.values, oldGridSize, 1) as Texture

        this.resetFields()
    }

    setCellSize = (cellSize: number) => {
        this.cellSize = cellSize

        this.resetFields()
    }

    stepElectric = (dt: number) => {
        const injectedEl = this.injectSource(this.data.electricSourceField.values, this.data.electricField.values, dt) as Texture
        this.data.electricSourceField.values = this.decaySource(this.copyFieldTexture("es")(this.data.electricSourceField.values), dt) as Texture

        this.data.electricField.values = this.updateElectric(injectedEl, this.data.magneticField.values, this.data.permittivity.values, dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        this.data.magneticField.values = this.updateMagnetic(this.data.electricField.values, this.copyFieldTexture("m")(this.data.magneticField.values), this.data.permeability.values, dt, this.cellSize, this.reflectiveBoundary) as Texture
        this.data.time += dt / 2
    }

    resetFields = () => {
        this.data.time = 0

        this.data.electricField.values = this.makeFieldTexture("e")([0, 0, 0, 0, 0, 0]) as Texture
        this.data.magneticField.values = this.makeFieldTexture("m")([0, 0, 0, 0, 0, 0]) as Texture
        this.data.electricSourceField.values = this.makeFieldTexture("es")([0, 0, 0, 0, 0, 0]) as Texture
    }

    resetMaterials = () => {
        this.data.permeability.values = this.makeMaterialTexture("permeability")([1, 0]) as Texture
        this.data.permittivity.values = this.makeMaterialTexture("permittivity")([1, 0]) as Texture
    }

    private drawShape = (field: VectorField2D, fieldName: string, drawInfo: DrawInfo, keep: number, isField: boolean) => {
        const drawFunc = isField ? this.drawOnField[drawInfo.drawShape](fieldName) : this.drawOnMaterial[drawInfo.drawShape](fieldName)
        const copiedValues = isField ? this.copyFieldTexture(fieldName)(field.values) : this.copyMaterialTexture(fieldName)(field.values)

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
        const materialField = materialType === "permeability" ? this.data.permeability : this.data.permittivity
        this.drawShape(materialField, materialType, drawInfo, 0, false)
    }

    injectSignal = (drawInfo: DrawInfo, dt: number) => {
        this.drawShape(this.data.electricSourceField, "es", { ...drawInfo, value: drawInfo.value.map(val => val * dt) }, 1, true)
    }

    loadPermittivity = (permittivity: number[][]) => {
        this.data.permittivity.values = this.copyMaterialTextureWithBounds("loadPermittivity")(permittivity, [permittivity[0].length, permittivity.length], 1) as Texture
    }

    loadPermeability = (permeability: number[][]) => {
        this.data.permeability.values = this.copyMaterialTextureWithBounds("loadPermeability")(permeability, [permeability[0].length, permeability.length], 1) as Texture
    }

    getData = () => this.data
}