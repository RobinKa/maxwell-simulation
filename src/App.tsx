import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { GPU } from "gpu.js"
import { FDTDSimulator } from "./simulator"
import { CollapsibleContainer, ControlComponent, SaveLoadComponent, SettingsComponent } from './components'
import { toggleFullScreen } from './util'
import Fullscreen from "./icons/fullscreen.png"
import "./App.css"

const defaultSignalBrushValue = 20
const defaultSignalBrushSize = 1
const defaultSignalFrequency = 3
const defaultMaterialBrushValue = 5
const defaultMaterialBrushSize = 5

const initialDt = 0.02
const initialCellSize = 0.03
const initialSimulationSpeed = 1
const initialGridSizeLongest = 500
const initialCanvasSize: [number, number] = [window.innerWidth, window.innerHeight]
const initialGridSize: [number, number] = calculateGridSize(initialGridSizeLongest, initialCanvasSize)

function calculateGridSize(gridSizeLongest: number, canvasSize: [number, number]): [number, number] {
    const canvasAspect = canvasSize[0] / canvasSize[1]

    return canvasSize[0] >= canvasSize[1] ?
        [gridSizeLongest, Math.ceil(gridSizeLongest / canvasAspect)] :
        [Math.ceil(gridSizeLongest * canvasAspect), gridSizeLongest]
}

const makeRenderSimulatorCanvas = (g: GPU, canvasSize: [number, number]) => {
    function getAt(field: number[][], shapeX: number, shapeY: number, x: number, y: number) {
        if (x < 0 || x >= shapeX || y < 0 || y >= shapeY) {
            return 0
        }

        return field[y][x]
    }

    return g.createKernel(function (electricFieldX: number[][], electricFieldY: number[][], electricFieldZ: number[][],
        magneticFieldX: number[][], magneticFieldY: number[][], magneticFieldZ: number[][],
        permittivity: number[][], permeability: number[][], gridSize: number[]) {
        const gx = gridSize[0]
        const gy = gridSize[1]

        const x = gx * this.thread.x! / (this.output.x as number)
        const y = gy * (1 - this.thread.y! / (this.output.y as number))

        const eAA =
            getAt(electricFieldX, gx, gy, x, y) * getAt(electricFieldX, gx, gy, x, y) +
            getAt(electricFieldY, gx, gy, x, y) * getAt(electricFieldY, gx, gy, x, y) +
            getAt(electricFieldZ, gx, gy, x, y) * getAt(electricFieldZ, gx, gy, x, y)

        // Magnetic field is offset from electric field, so get value at +0.5 by interpolating 0 and 1
        const magXAA = getAt(magneticFieldX, gx, gy, x - 0.5, y - 0.5)
        const magYAA = getAt(magneticFieldY, gx, gy, x - 0.5, y - 0.5)
        const magZAA = getAt(magneticFieldZ, gx, gy, x - 0.5, y - 0.5)

        const mAA = magXAA * magXAA + magYAA * magYAA + magZAA * magZAA

        const scale = 15

        // Material constants are between 1 and 100, so take log10 ([0, 2]) and divide by 2 to get full range
        const permittivityValue = 0.1 + 0.9 * Math.max(0, Math.min(1, (0.4342944819 * Math.log(getAt(permittivity, gx, gy, x, y))) / 2))
        const permeabilityValue = 0.1 + 0.9 * Math.max(0, Math.min(1, (0.4342944819 * Math.log(getAt(permeability, gx, gy, x, y))) / 2))

        const backgroundX = (Math.abs(x % 1 - 0.5) < 0.25 ? 1 : 0) * (Math.abs(y % 1 - 0.5) < 0.25 ? 1 : 0)
        const backgroundY = 1 - backgroundX

        this.color(Math.min(1, eAA / scale + 0.7 * backgroundX * permittivityValue), Math.min(1, eAA / scale + mAA / scale), Math.min(1, mAA / scale + 0.7 * backgroundY * permeabilityValue))
    }).setOutput(canvasSize).setGraphical(true).setFunctions([getAt]).setWarnVarUsage(false).setTactic("performance").setPrecision("unsigned").setDynamicOutput(true).setDynamicArguments(true)
}

function clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

export default function () {
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const [canvasSize, setCanvasSize] = useState<[number, number]>(initialCanvasSize)
    const [gridSizeLongest, setGridSizeLongest] = useState(initialGridSizeLongest)
    const [dt, setDt] = useState(initialDt)
    const [cellSize, setCellSize] = useState(initialCellSize)
    const [simulationSpeed, setSimulationSpeed] = useState(initialSimulationSpeed)

    useEffect(() => {
        const adjustCanvasSize = () => setCanvasSize([window.innerWidth, window.innerHeight])

        window.addEventListener("resize", adjustCanvasSize)
        return () => window.removeEventListener("resize", adjustCanvasSize)
    }, [])

    const gridSize = useMemo<[number, number]>(() => calculateGridSize(gridSizeLongest, canvasSize), [canvasSize, gridSizeLongest])

    // Would use useMemo for gpu here, but useMemo does not seem to work with ref dependencies.
    const [gpu, setGpu] = useState<GPU | null>(null)
    useEffect(() => {
        if (drawCanvasRef.current) {
            setGpu(new GPU({ mode: "webgl", canvas: drawCanvasRef.current }))
        }
    }, [drawCanvasRef])

    const simulator = useMemo(() => gpu ? new FDTDSimulator(gpu, initialGridSize, initialCellSize) : null, [gpu])
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

    const simStep = useCallback(() => {
        if (simulator) {
            const simData = simulator.getData()

            if (mouseDownPos.current !== null) {
                const centerX = clamp(0, gridSize[0] - 1, Math.floor(gridSize[0] * mouseDownPos.current[0] / canvasSize[0]))
                const centerY = clamp(0, gridSize[1] - 1, Math.floor(gridSize[1] * mouseDownPos.current[1] / canvasSize[1]))
                const brushHalfSize = Math.round(brushSize / 2)

                simulator.injectSignal([centerX, centerY], brushHalfSize, -brushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * simData.time), dt)
            }

            simulator.stepMagnetic(dt)
            simulator.stepElectric(dt)
        }
    }, [simulator, canvasSize, gridSize, dt, signalFrequency, brushValue, brushSize])

    useEffect(() => {
        const timer = setInterval(simStep, 1000 / simulationSpeed * dt)
        return () => clearInterval(timer)
    }, [simStep, dt, simulationSpeed])

    const drawStep = useCallback(() => {
        if (simulator && renderSim) {
            if (drawCanvasRef.current) {
                drawCanvasRef.current.width = window.innerWidth
                drawCanvasRef.current.height = window.innerHeight
            }

            const simData = simulator.getData()

            if (simData.time > 0) {
                renderSim(simData.electricFieldX.values, simData.electricFieldY.values, simData.electricFieldZ.values,
                    simData.magneticFieldX.values, simData.magneticFieldY.values, simData.magneticFieldZ.values,
                    simData.permittivity.values, simData.permeability.values, gridSize)
            }
        }
    }, [simulator, renderSim, gridSize, drawCanvasRef])

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

    const changePermittivity = useCallback((canvasPos: [number, number]) => {
        if (simulator) {
            const centerX = Math.round(gridSize[0] * (canvasPos[0] / canvasSize[0]))
            const centerY = Math.round(gridSize[1] * (canvasPos[1] / canvasSize[1]))
            const brushHalfSize = Math.round(brushSize / 2)

            simulator.drawPermittivity([centerX, centerY, 0], brushHalfSize, brushValue)
        }
    }, [simulator, gridSize, canvasSize, brushSize, brushValue])

    const changePermeability = useCallback((canvasPos: [number, number]) => {
        if (simulator) {
            const centerX = Math.round(gridSize[0] * (canvasPos[0] / canvasSize[0]))
            const centerY = Math.round(gridSize[1] * (canvasPos[1] / canvasSize[1]))
            const brushHalfSize = Math.round(brushSize / 2)

            simulator.drawPermeability([centerX, centerY, 0], brushHalfSize, brushValue)
        }
    }, [simulator, gridSize, canvasSize, brushSize, brushValue])

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
                changePermittivity([clientX, clientY])
                setDrawingPermittivity(true)
            } else if (clickOption === optionPermeabilityBrush) {
                changePermeability([clientX, clientY])
                setDrawingPermeability(true)
            }
        }
    }, [simulator, changePermittivity, changePermeability, clickOption])

    const onInputMove = useCallback(([clientX, clientY]: [number, number]) => {
        if (simulator) {
            if (clickOption === optionSignal && mouseDownPos.current !== null) {
                mouseDownPos.current = [clientX, clientY]
            }

            if (drawingPermittivity) {
                changePermittivity([clientX, clientY])
            }

            if (drawingPermeability) {
                changePermeability([clientX, clientY])
            }
        }
    }, [simulator, changePermittivity, changePermeability, clickOption, drawingPermeability, drawingPermittivity])

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
            <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef} style={{ position: "absolute", width: canvasSize[0], height: canvasSize[1] }}
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

            <img onClick={toggleFullScreen} src={Fullscreen} alt="Fullscreen" style={{position: "absolute", right: 10, top: 10, cursor: "pointer"}} />

            <CollapsibleContainer id="Menu" title="Menu" buttonStyle={{background: "rgb(60, 60, 60)"}}>
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
                        cellSize={cellSize} setCellSize={setCellSize}
                        dt={dt} setDt={setDt} />
                </CollapsibleContainer>
            </CollapsibleContainer>
        </div>
    )
}
