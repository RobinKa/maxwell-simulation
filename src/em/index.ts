import { createReglFromCanvas, makeRenderSimulatorCanvas } from "./rendering"
import { FDTDSimulator, MaterialType, Simulator } from "./simulator"
import { SignalSource } from "./sources"
import { DrawInfo } from "./drawing"

export type EMState = {
    renderToCanvas: (showElectric: boolean, showMagnetic: boolean) => void
    adjustCanvasSize: (canvasSize: [number, number]) => void
    stepSim: (dt: number) => void

    injectSignal: (drawInfo: DrawInfo, dt: number) => void

    getSources: () => SignalSource[]
    setSources: (newSources: SignalSource[]) => void

    getGridSize: () => [number, number]
    setGridSize: (newGridSize: [number, number]) => void

    getCellSize: () => number
    setCellSize: (newCellSize: number) => void

    getReflectiveBoundary: () => boolean
    setReflectiveBoundary: (reflectiveBoundary: boolean) => void

    getTime: () => number

    loadMaterialFromComponents: (permittivity: number[][], permeability: number[][], conductivity: number[][]) => void
    resetFields: () => void
    resetMaterials: () => void

    drawMaterial: (materialType: MaterialType, drawInfo: DrawInfo) => void
    getMaterial: () => number[][][]
}

export function createEM(canvas: HTMLCanvasElement, gridSize: [number, number],
    cellSize: number, reflectiveBoundary: boolean, dt: number): EMState {
    const regl = createReglFromCanvas(canvas)

    const { render, adjustCanvasSize, adjustGridSize } = makeRenderSimulatorCanvas(regl, [canvas.width, canvas.height], gridSize)
    const sim: Simulator = new FDTDSimulator(regl, gridSize, cellSize, reflectiveBoundary, dt)

    const renderToCanvas = (showElectric: boolean, showMagnetic: boolean) => {
        const simData = sim.getData()

        render(simData.electricField.current, simData.magneticField.current,
            simData.material.current, sim.getCellSize(), sim.getGridSize(),
            showElectric, showMagnetic)
    }

    let sources: SignalSource[] = []

    const stepSim = (dt: number) => {
        for (const source of sources) {
            source.inject(sim, dt)
        }

        sim.stepMagnetic(dt)
        sim.stepElectric(dt)
    }

    const setGridSize = (newGridSize: [number, number]) => {
        sim.setGridSize(newGridSize)
        adjustGridSize(newGridSize)
    }

    return {
        renderToCanvas: renderToCanvas,
        adjustCanvasSize: adjustCanvasSize,
        stepSim: stepSim,
        injectSignal: sim.injectSignal,
        getSources: () => sources,
        setSources: (newSources: SignalSource[]) => sources = newSources,
        getGridSize: sim.getGridSize,
        setGridSize: setGridSize,
        getCellSize: sim.getCellSize,
        setCellSize: sim.setCellSize,
        getTime: () => sim.getData().time,
        getReflectiveBoundary: sim.getReflectiveBoundary,
        setReflectiveBoundary: sim.setReflectiveBoundary,
        loadMaterialFromComponents: sim.loadMaterialFromComponents,
        resetFields: sim.resetFields,
        resetMaterials: sim.resetMaterials,
        drawMaterial: sim.drawMaterial,
        getMaterial: sim.getMaterial
    }
}