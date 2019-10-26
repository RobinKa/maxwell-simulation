import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { GPU, GPUMode, GPUInternalMode } from "gpu.js"
import { FDTDSimulator } from "./simulator"
import { CollapsibleContainer, ControlComponent, SaveLoadComponent, SettingsComponent, ExamplesComponent } from './components'
import { toggleFullScreen, clamp } from './util'
import Fullscreen from "./icons/fullscreen.png"
import "./App.css"
import { SignalSource } from './sources'
import * as k from './kernels/rendering'

function getGpuMode(): GPUMode | GPUInternalMode {
    if (GPU.isSinglePrecisionSupported) {
        if (GPU.isWebGL2Supported) {
            return "webgl2"
        } else if (GPU.isWebGLSupported) {
            return "webgl"
        }
    }

    return "cpu"
}

const gpuMode = getGpuMode()
console.log(`Using GPU mode ${gpuMode}`)

const defaultSignalBrushValue = gpuMode === "cpu" ? 5 : 50
const defaultSignalBrushSize = 1
const defaultSignalFrequency = gpuMode === "cpu" ? 1 : 3
const defaultMaterialBrushValue = 5
const defaultMaterialBrushSize = 5

const initialDt = gpuMode === "cpu" ? 0.026 : 0.013
const initialCellSize = gpuMode === "cpu" ? 0.04 : 0.02
const initialSimulationSpeed = 1
const initialGridSizeLongest = gpuMode === "cpu" ? 200 : 400
const initialResolutionScale = gpuMode === "cpu" ? 0.3 : 1
const initialWindowSize: [number, number] = [window.innerWidth, window.innerHeight]
const initialCanvasSize: [number, number] = calculateCanvasSize(initialWindowSize, initialResolutionScale)
const initialGridSize: [number, number] = calculateGridSize(initialGridSizeLongest, initialCanvasSize)
const initialReflectiveBoundary = false

function calculateCanvasSize(windowSize: [number, number], resolutionScale: number): [number, number] {
    return [Math.round(windowSize[0] * resolutionScale), Math.round(windowSize[1] * resolutionScale)]
}

function calculateGridSize(gridSizeLongest: number, canvasSize: [number, number]): [number, number] {
    const canvasAspect = canvasSize[0] / canvasSize[1]

    return canvasSize[0] >= canvasSize[1] ?
        [gridSizeLongest, Math.ceil(gridSizeLongest / canvasAspect)] :
        [Math.ceil(gridSizeLongest * canvasAspect), gridSizeLongest]
}

const makeRenderSimulatorCanvas = (gpu: GPU, canvasSize: [number, number]) => {
    const kernel = gpuMode !== "cpu" ? gpu.createKernel(k.drawGpu) : gpu.createKernel(k.drawCpu)
    return kernel.setOutput(canvasSize).setGraphical(true).setFunctions([k.getAt]).setWarnVarUsage(false).setTactic("performance").setPrecision("unsigned").setDynamicOutput(true).setDynamicArguments(true)
}

export default function () {
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const [canvasSize, setCanvasSize] = useState<[number, number]>(initialCanvasSize)
    const [windowSize, setWindowSize] = useState<[number, number]>(initialWindowSize)
    const [gridSizeLongest, setGridSizeLongest] = useState(initialGridSizeLongest)
    const [dt, setDt] = useState(initialDt)
    const [cellSize, setCellSize] = useState(initialCellSize)
    const [resolutionScale, setResolutionScale] = useState(initialResolutionScale)
    const [simulationSpeed, setSimulationSpeed] = useState(initialSimulationSpeed)
    const [reflectiveBoundary, setReflectiveBoundary] = useState(initialReflectiveBoundary)

    const [sources, setSources] = useState<SignalSource[]>([])

    useEffect(() => {
        const adjustCanvasSize = () => {
            const wndSize: [number, number] = [window.innerWidth, window.innerHeight]
            setCanvasSize(calculateCanvasSize(wndSize, resolutionScale))
            setWindowSize(wndSize)
        }

        adjustCanvasSize()

        window.addEventListener("resize", adjustCanvasSize)
        return () => window.removeEventListener("resize", adjustCanvasSize)
    }, [resolutionScale])

    const gridSize = useMemo<[number, number]>(() => calculateGridSize(gridSizeLongest, canvasSize), [canvasSize, gridSizeLongest])

    // Would use useMemo for gpu here, but useMemo does not seem to work with ref dependencies.
    const [gpu, setGpu] = useState<GPU | null>(null)
    useEffect(() => {
        if (drawCanvasRef.current) {
            setGpu(new GPU({ mode: gpuMode, canvas: drawCanvasRef.current }))
        }
    }, [drawCanvasRef])

    const simulator = useMemo(() => gpu ? new FDTDSimulator(gpu, initialGridSize, initialCellSize, initialReflectiveBoundary) : null, [gpu])
    const renderSim = useMemo(() => gpu ? makeRenderSimulatorCanvas(gpu, initialGridSize) : null, [gpu])

    // Update render sim output size
    useEffect(() => {
        if (renderSim) {
            renderSim.setOutput(canvasSize)
        }
    }, [renderSim, canvasSize])

    // Update simulator grid size
    useEffect(() => {
        if (simulator) {
            simulator.setGridSize(gridSize)
        }
    }, [simulator, gridSize])

    // Update simulator cell size
    useEffect(() => {
        if (simulator) {
            simulator.setCellSize(cellSize)
        }
    }, [simulator, cellSize])

    // Update reflective boundary
    useEffect(() => {
        if (simulator) {
            simulator.reflectiveBoundary = reflectiveBoundary
        }
    }, [simulator, reflectiveBoundary])

    const [brushSize, setBrushSize] = useState(defaultSignalBrushSize)
    const [brushValue, setBrushValue] = useState(defaultSignalBrushValue)
    const [signalFrequency, setSignalFrequency] = useState(defaultSignalFrequency)
    const [drawingPermeability, setDrawingPermeability] = useState(false)
    const [drawingPermittivity, setDrawingPermittivity] = useState(false)
    const [clickOption, setClickOption] = useState(2) // eps, mu, signal
    const optionPermittivityBrush = 0
    const optionPermeabilityBrush = 1
    const optionSignal = 2

    const [mousePosition, setMousePosition] = useState<[number, number] | null>(null)

    const signalStrength = useRef(0)
    const mouseDownPos = useRef<[number, number] | null>(null)

    const windowToSimulationPoint = useMemo(() => {
        return (windowPoint: [number, number]) => {
            const simulationPoint: [number, number] = [
                clamp(0, gridSize[0] - 1, Math.floor(gridSize[0] * windowPoint[0] / windowSize[0])),
                clamp(0, gridSize[1] - 1, Math.floor(gridSize[1] * windowPoint[1] / windowSize[1]))
            ]
            return simulationPoint
        }
    }, [windowSize, gridSize])

    const simStep = useCallback(() => {
        if (simulator) {
            const simData = simulator.getData()

            if (mouseDownPos.current !== null) {
                const center = windowToSimulationPoint(mouseDownPos.current)
                const brushHalfSize = Math.round(brushSize / 2)

                simulator.injectSignal(center, brushHalfSize, -brushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * simData.time), dt)
            }

            for (const source of sources) {
                source.inject(simulator, dt)
            }

            simulator.stepMagnetic(dt)
            simulator.stepElectric(dt)
        }
    }, [simulator, dt, signalFrequency, brushValue, brushSize, sources, windowToSimulationPoint])

    useEffect(() => {
        if (simulationSpeed > 0) {
            const timer = setInterval(simStep, 1000 / simulationSpeed * dt)
            return () => clearInterval(timer)
        }

        return undefined
    }, [simStep, dt, simulationSpeed])

    const drawStep = useCallback(() => {
        if (simulator && renderSim) {
            if (drawCanvasRef.current) {
                const cnvSize = calculateCanvasSize([window.innerWidth, window.innerHeight], resolutionScale)
                drawCanvasRef.current.width = cnvSize[0]
                drawCanvasRef.current.height = cnvSize[1]
            }

            const simData = simulator.getData()

            if (simData.time > 0) {
                renderSim(simData.electricFieldX.values, simData.electricFieldY.values, simData.electricFieldZ.values,
                    simData.magneticFieldX.values, simData.magneticFieldY.values, simData.magneticFieldZ.values,
                    simData.permittivity.values, simData.permeability.values, gridSize)
            }
        }
    }, [simulator, renderSim, gridSize, resolutionScale, drawCanvasRef])

    useEffect(() => {
        let stop = false
        const drawIfNotStopped = () => {
            if (!stop) {
                drawStep()
                requestAnimationFrame(drawIfNotStopped)
            }
        }

        requestAnimationFrame(drawIfNotStopped)

        return () => { stop = true }
    }, [drawStep])

    const changeMaterial = useCallback((canvasPos: [number, number], material: "permittivity" | "permeability") => {
        if (simulator) {
            const centerX = Math.round(gridSize[0] * (canvasPos[0] / windowSize[0]))
            const centerY = Math.round(gridSize[1] * (canvasPos[1] / windowSize[1]))
            const brushHalfSize = Math.round(brushSize / 2)

            if (material === "permittivity") {
                simulator.drawPermittivity([centerX, centerY, 0], brushHalfSize, brushValue)
            } else {
                simulator.drawPermeability([centerX, centerY, 0], brushHalfSize, brushValue)
            }

        }
    }, [simulator, gridSize, windowSize, brushSize, brushValue])

    const resetMaterials = useCallback(() => {
        if (simulator) {
            simulator.resetMaterials()
        }
    }, [simulator])

    const resetFields = useCallback(() => {
        if (simulator) {
            simulator.resetFields()
            signalStrength.current = 0
        }
    }, [simulator])

    const onInputDown = useCallback(([clientX, clientY]: [number, number]) => {
        if (simulator) {
            if (clickOption === optionSignal) {
                mouseDownPos.current = [clientX, clientY]
            } else if (clickOption === optionPermittivityBrush) {
                changeMaterial([clientX, clientY], "permittivity")
                setDrawingPermittivity(true)
            } else if (clickOption === optionPermeabilityBrush) {
                changeMaterial([clientX, clientY], "permeability")
                setDrawingPermeability(true)
            }
        }
    }, [simulator, changeMaterial, clickOption])

    const onInputMove = useCallback(([clientX, clientY]: [number, number]) => {
        if (simulator) {
            if (clickOption === optionSignal && mouseDownPos.current !== null) {
                mouseDownPos.current = [clientX, clientY]
            }

            if (drawingPermittivity) {
                changeMaterial([clientX, clientY], "permittivity")
            }

            if (drawingPermeability) {
                changeMaterial([clientX, clientY], "permeability")
            }
        }
    }, [simulator, changeMaterial, clickOption, drawingPermeability, drawingPermittivity])

    const onInputUp = useCallback(() => {
        if (clickOption === optionSignal) {
            mouseDownPos.current = null
        } else if (clickOption === optionPermeabilityBrush) {
            setDrawingPermeability(false)
        } else if (clickOption === optionPermittivityBrush) {
            setDrawingPermittivity(false)
        }
    }, [clickOption])

    // Remember old brush values for signal and material
    const [previousClickOption, setPreviousClickOption] = useState(optionSignal)
    const [signalBrushSize, setSignalBrushSize] = useState(defaultSignalBrushSize)
    const [signalBrushValue, setSignalBrushValue] = useState(defaultSignalBrushValue)
    const [materialBrushSize, setMaterialBrushSize] = useState(defaultMaterialBrushSize)
    const [materialBrushValue, setMaterialBrushValue] = useState(defaultMaterialBrushValue)
    useEffect(() => {
        if (clickOption === optionSignal && previousClickOption !== optionSignal) {
            setMaterialBrushSize(brushSize)
            setMaterialBrushValue(brushValue)
            setBrushSize(signalBrushSize)
            setBrushValue(signalBrushValue)
        } else if (clickOption !== optionSignal && previousClickOption === optionSignal) {
            setSignalBrushSize(brushSize)
            setSignalBrushValue(brushValue)
            setBrushSize(materialBrushSize)
            setBrushValue(materialBrushValue)
        }

        setPreviousClickOption(clickOption)
    }, [clickOption, previousClickOption, signalBrushSize, signalBrushValue, materialBrushSize, materialBrushValue, brushSize, brushValue])

    return (
        <div style={{ touchAction: "none", userSelect: "none" }}>
            <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef} style={{ position: "absolute", width: windowSize[0], height: windowSize[1] }}
                onMouseDown={e => onInputDown([e.clientX, e.clientY])}
                onMouseMove={e => { setMousePosition([e.clientX, e.clientY]); onInputMove([e.clientX, e.clientY]) }}
                onMouseUp={e => onInputUp()}
                onMouseLeave={e => onInputUp()}
                onTouchStart={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputDown([e.touches[0].clientX, e.touches[0].clientY]) }}
                onTouchMove={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputMove([e.touches[0].clientX, e.touches[0].clientY]) }}
                onTouchEnd={e => { setMousePosition(null); onInputUp() }}
                onTouchCancel={e => { setMousePosition(null); onInputUp() }}
                onContextMenu={e => e.preventDefault()}
            />

            <div style={{ position: "absolute", bottom: 10, right: 10 }}>
                <a href="https://github.com/RobinKa/maxwell-simulation" rel="noopener noreferrer" target="_blank" style={{ fontWeight: "lighter", color: "rgba(255, 255, 255, 100)", textDecoration: "none" }}>Source code</a>
            </div>

            {mousePosition &&
                <div style={{ position: "absolute", pointerEvents: "none", left: mousePosition[0] - (2 * (brushSize + 1)), top: mousePosition[1] - (2 * (brushSize + 1)), width: 4 * (brushSize + 1), height: 4 * (brushSize + 1), border: "2px solid yellow" }} />
            }

            {gpuMode === "cpu" &&
                <div style={{ position: "absolute", pointerEvents: "none", left: 10, bottom: 10, color: "red", fontWeight: "lighter" }}>Using CPU (WebGL with float textures unsupported by your device)</div>
            }

            <img onClick={toggleFullScreen} src={Fullscreen} alt="Fullscreen" style={{ position: "absolute", right: 10, top: 10, cursor: "pointer" }} />

            <CollapsibleContainer id="Menu" title="Menu" buttonStyle={{ background: "rgb(60, 60, 60)" }}>
                <CollapsibleContainer title="Examples">
                    <ExamplesComponent
                        simulator={simulator} setCellSize={setCellSize} setDt={setDt}
                        setGridSizeLongest={setGridSizeLongest} setSimulationSpeed={setSimulationSpeed}
                        setSources={setSources} gridSize={gridSize} dt={dt}
                        cellSize={cellSize} simulationSpeed={simulationSpeed} />
                </CollapsibleContainer>
                <CollapsibleContainer title="Controls">
                    <ControlComponent
                        brushSize={brushSize} setBrushSize={setBrushSize}
                        brushValue={brushValue} setBrushValue={setBrushValue}
                        signalFrequency={signalFrequency} setSignalFrequency={setSignalFrequency}
                        clickOption={clickOption} setClickOption={setClickOption}
                        resetFields={resetFields} resetMaterials={resetMaterials} />
                </CollapsibleContainer>
                <CollapsibleContainer title="Save / Load" initiallyCollapsed={true}>
                    <SaveLoadComponent simulator={simulator} gridSize={gridSize} />
                </CollapsibleContainer>
                <CollapsibleContainer title="Settings" initiallyCollapsed={true}>
                    <SettingsComponent
                        gridSizeLongest={gridSizeLongest} setGridSizeLongest={setGridSizeLongest}
                        simulationSpeed={simulationSpeed} setSimulationSpeed={setSimulationSpeed}
                        resolutionScale={resolutionScale} setResolutionScale={setResolutionScale}
                        cellSize={cellSize} setCellSize={setCellSize}
                        reflectiveBoundary={reflectiveBoundary} setReflectiveBoundary={setReflectiveBoundary}
                        dt={dt} setDt={setDt} />
                </CollapsibleContainer>
            </CollapsibleContainer>
        </div>
    )
}
