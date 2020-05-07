import { EMState, createEM } from "./em"
import { qualityPresets } from "./util"

export function calculateCanvasSize(windowSize: [number, number], resolutionScale: number): [number, number] {
    return [Math.round(windowSize[0] * resolutionScale), Math.round(windowSize[1] * resolutionScale)]
}

function calculateGridSize(gridSizeLongest: number, canvasSize: [number, number]): [number, number] {
    const canvasAspect = canvasSize[0] / canvasSize[1]

    return canvasSize[0] >= canvasSize[1] ?
        [gridSizeLongest, Math.ceil(gridSizeLongest / canvasAspect)] :
        [Math.ceil(gridSizeLongest * canvasAspect), gridSizeLongest]
}

const defaultPreset = qualityPresets["Medium"]

const initialDt = defaultPreset.dt
const initialCellSize = defaultPreset.cellSize
const initialSimulationSpeed = 1
const initialGridSizeLongest = defaultPreset.gridSizeLongest
const initialResolutionScale = defaultPreset.resolutionScale
const initialWindowSize: [number, number] = [window.innerWidth, window.innerHeight]
const initialCanvasSize: [number, number] = calculateCanvasSize(initialWindowSize, initialResolutionScale)
const initialGridSize: [number, number] = calculateGridSize(initialGridSizeLongest, initialCanvasSize)
const initialReflectiveBoundary = false

export type AppState = {
    drawCanvas: HTMLCanvasElement | null
    urlShareId: string | null
    shareId: string | null
    canvasSize: [number, number]
    windowSize: [number, number]
    gridSizeLongest: number
    dt: number
    gridSize: [number, number]
    reflectiveBoundary: boolean
    cellSize: number
    resolutionScale: number
    simulationSpeed: number
    em: EMState | null
}

export type AppStateAction = {
    drawCanvas?: HTMLCanvasElement | null
    dt?: number
    resolutionScale?: number
    simulationSpeed?: number
    urlShareId?: string | null
    shareId?: string | null
    windowSize?: [number, number]
    cellSize?: number
    reflectiveBoundary?: boolean
    gridSizeLongest?: number
}

export const makeAppState = () => {
    const state: AppState = {
        drawCanvas: null,
        urlShareId: null,
        shareId: null,
        canvasSize: initialCanvasSize,
        windowSize: initialWindowSize,
        gridSizeLongest: initialGridSizeLongest,
        dt: initialDt,
        resolutionScale: initialResolutionScale,
        simulationSpeed: initialSimulationSpeed,
        gridSize: initialGridSize,
        cellSize: initialCellSize,
        reflectiveBoundary: initialReflectiveBoundary,
        em: null
    }

    return state
}

export const appReducer = (state: AppState, action: AppStateAction) => {
    let shouldRecalculateCanvasSize = false
    let shouldRecalculateGridSize = false
    let shouldResetFieldAndMaterial = false

    if (action.drawCanvas !== undefined) {
        state.drawCanvas = action.drawCanvas
        if (state.drawCanvas !== null) {
            state.em = createEM(state.drawCanvas, state.gridSize, state.cellSize,
                state.reflectiveBoundary, state.dt)
        } else {
            state.em = null
        }
    }

    if (action.dt !== undefined) {
        state.dt = action.dt
    }

    if (action.resolutionScale !== undefined) {
        state.resolutionScale = action.resolutionScale
    }

    if (action.simulationSpeed !== undefined) {
        state.simulationSpeed = action.simulationSpeed
    }

    if (action.urlShareId !== undefined) {
        state.urlShareId = action.urlShareId
    }

    if (action.shareId !== undefined) {
        state.shareId = action.shareId
    }

    if (action.windowSize !== undefined) {
        state.windowSize = action.windowSize
        
        shouldRecalculateCanvasSize = true
        shouldRecalculateGridSize = true
        shouldResetFieldAndMaterial = true
    }

    if (action.cellSize !== undefined) {
        state.cellSize = action.cellSize

        state.em?.setCellSize(action.cellSize)
    }

    if (action.reflectiveBoundary !== undefined) {
        state.reflectiveBoundary = action.reflectiveBoundary

        state.em?.setReflectiveBoundary(action.reflectiveBoundary)
    }

    if (action.gridSizeLongest !== undefined) {
        state.gridSizeLongest = action.gridSizeLongest
        
        shouldRecalculateGridSize = true
        // TODO: Want to reset, but that also resets the
        // material after loading the grid length
        // shouldReset = true
    }

    // See if we need to tell EM about anything new
    if (state.em) {
        if (shouldRecalculateCanvasSize) {
            state.canvasSize = calculateCanvasSize(state.windowSize, state.resolutionScale)

            if (state.drawCanvas) {
                state.drawCanvas.width = state.canvasSize[0]
                state.drawCanvas.height = state.canvasSize[1]
            }

            state.em.adjustCanvasSize(state.canvasSize)
        }

        if (shouldRecalculateGridSize) {
            state.gridSize = calculateGridSize(state.gridSizeLongest, state.canvasSize)
            state.em.setGridSize(state.gridSize)
        }

        if (shouldResetFieldAndMaterial) {
            state.em.resetFields()
            state.em.resetMaterials()
        }
    }

    return state
}
