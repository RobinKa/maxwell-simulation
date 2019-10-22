import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { GPU } from "gpu.js"
import { FDTDSimulator } from "./simulator"
import { simulatorMapToImageUrl, imageUrlToSimulatorMap } from './util'

const dt = 0.02
const cellSize = 0.04

const defaultSignalBrushValue = 10
const defaultSignalBrushSize = 1
const defaultMaterialBrushValue = 5
const defaultMaterialBrushSize = 5

const initialCanvasSize: [number, number] = [window.innerWidth, window.innerHeight]
const initialGridSize: [number, number] = [1, 1]

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
        const permittivityValue = 0.3 + 0.7 * Math.max(0, Math.min(1, (0.4342944819 * Math.log(getAt(permittivity, gx, gy, x, y))) / 2))
        const permeabilityValue = 0.3 + 0.7 * Math.max(0, Math.min(1, (0.4342944819 * Math.log(getAt(permeability, gx, gy, x, y))) / 2))

        const backgroundX = (Math.abs(x % 1 - 0.5) < 0.25 ? 1 : 0) * (Math.abs(y % 1 - 0.5) < 0.25 ? 1 : 0)
        const backgroundY = 1 - backgroundX

        this.color(Math.min(1, eAA / scale + 0.5 * backgroundX * permittivityValue), Math.min(1, eAA / scale + mAA / scale), Math.min(1, mAA / scale + 0.5 * backgroundY * permeabilityValue))
    }).setOutput(canvasSize).setGraphical(true).setFunctions([getAt]).setWarnVarUsage(false).setTactic("performance").setPrecision("unsigned").setDynamicOutput(true).setDynamicArguments(true)
}

function clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

type LabeledSliderProps = {
    label: string
    value: number,
    setValue: (value: number) => void
    min: number
    max: number
    step: number
}

function LabeledSlider(props: LabeledSliderProps) {
    return (
        <div>
            <label>{props.label}</label>
            <div>
                <input type="range" min={props.min} max={props.max} value={props.value} step={props.step}
                    onChange={e => props.setValue(parseFloat(e.target.value))} style={{ height: 10, width: "100%" }} />
                <div style={{ textAlign: "center", lineHeight: 0.1, marginBottom: "7px" }}>
                    {props.value}
                </div>
            </div>
        </div>
    )
}

type OptionSelectorProps = {
    options: string[]
    selectedOption: number
    setSelectedOption: (selectedOption: number) => void
}

function OptionSelector(props: OptionSelectorProps) {
    return (
        <div>
            {props.options.map((option, optionIndex) =>
                <button key={option} style={{
                    boxSizing: "border-box",
                    border: optionIndex === props.selectedOption ? "4px solid rgb(0, 150, 255)" : "0",
                    height: "30px",
                    margin: "5px",
                    width: `${100 / props.options.length}%`, background: "rgb(100, 100, 100)", color: "white"
                }}
                    onClick={e => props.setSelectedOption(optionIndex)}>
                    {option}
                </button>
            )}
        </div>
    )
}

type ControlWidgerProps = {
    simulator: FDTDSimulator | null

    gridSize: [number, number]

    gridSizeLongest: number
    setGridSizeLongest: (gridSizeLongest: number) => void

    brushSize: number,
    setBrushSize: (brushSize: number) => void

    brushValue: number
    setBrushValue: (brushValue: number) => void

    signalFrequency: number,
    setSignalFrequency: (signalFrequency: number) => void

    clickOption: number
    setClickOption: (clickOption: number) => void

    resetFields: () => void
    resetMaterials: () => void
}

function ControlWidget(props: ControlWidgerProps) {
    const [collapsed, setCollapsed] = useState(false)
    const [simulatorMapUrl, setSimulatorMapUrl] = useState("")

    const simulator = props.simulator
    const gridSize = props.gridSize

    const onSaveClicked = useCallback(() => {
        if (simulator) {
            const simData = simulator.getData()

            window.open(simulatorMapToImageUrl({
                permittivity: simData.permittivity.values.toArray() as number[][],
                permeability: simData.permeability.values.toArray() as number[][],
                shape: [simData.permeability.shape[0], simData.permeability.shape[1]]
            }))
        }
    }, [simulator])

    const onLoadClicked = useCallback(() => {
        if (simulator) {
            imageUrlToSimulatorMap(simulatorMapUrl, [gridSize[0], gridSize[1]], map => {
                if (simulator) {
                    simulator.loadPermeability(map.permeability)
                    simulator.loadPermittivity(map.permittivity)
                }
            })
        }
    }, [simulator, gridSize, simulatorMapUrl])

    return (
        <div style={{ userSelect: "none" }}>
            <div style={{ textAlign: "center", position: "absolute", opacity: 0.8, background: "rgba(33, 33, 33, 100)", fontWeight: "lighter", color: "white" }}>
                <button onClick={e => setCollapsed(!collapsed)} style={{ width: "100%", height: "30px", background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", fontWeight: "bold", cursor: "pointer" }}>
                    Controls [{collapsed ? "+" : "-"}]
                </button>
                {!collapsed && (
                    <div style={{ padding: "10px" }}>
                        <div>
                            <button onClick={onSaveClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Save map</button>
                        </div>
                        <div>
                            <input type="text" onChange={e => setSimulatorMapUrl(e.target.value)} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }} />
                            <button onClick={onLoadClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Load map url</button>
                        </div>
                        <LabeledSlider label="Grid length" value={props.gridSizeLongest} setValue={props.setGridSizeLongest} min={100} max={2000} step={100} />
                        <LabeledSlider label="Brush size" value={props.brushSize} setValue={props.setBrushSize} min={1} max={100} step={1} />
                        <LabeledSlider label="Brush value" value={props.brushValue} setValue={props.setBrushValue} min={1} max={100} step={1} />
                        <LabeledSlider label="Signal frequency" value={props.signalFrequency} setValue={props.setSignalFrequency} min={0} max={5} step={0.5} />
                        <OptionSelector options={["ε brush", "µ brush", "Signal"]} selectedOption={props.clickOption} setSelectedOption={props.setClickOption} />
                        <div>
                            <button onClick={props.resetFields} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Reset fields</button>
                            <button onClick={props.resetMaterials} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Reset materials</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function () {
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const [canvasSize, setCanvasSize] = useState<[number, number]>(initialCanvasSize)
    const [gridSizeLongest, setGridSizeLongest] = useState(600)

    useEffect(() => {
        const adjustCanvasSize = () => setCanvasSize([window.innerWidth, window.innerHeight])

        window.addEventListener("resize", adjustCanvasSize)
        return () => window.removeEventListener("resize", adjustCanvasSize)
    }, [])

    const gridSize = useMemo<[number, number]>(() => {
        const canvasAspect = canvasSize[0] / canvasSize[1]

        return canvasSize[0] >= canvasSize[1] ?
            [gridSizeLongest, Math.ceil(gridSizeLongest / canvasAspect)] :
            [Math.ceil(gridSizeLongest * canvasAspect), gridSizeLongest]
    }, [canvasSize, gridSizeLongest])

    // This line gives a warning because react does not know when .current changes. All we need is for the .current value to be populated
    // before this memo is executed which this achieves. useMemo with ref as dependency does not work as expected (.current will be null) even
    // though this does work using useEffect.
    // eslint-disable-next-line
    const gpu = useMemo(() => drawCanvasRef.current ? new GPU({ mode: "webgl", canvas: drawCanvasRef.current }) : null, [drawCanvasRef.current])
    const simulator = useMemo(() => gpu ? new FDTDSimulator(gpu, initialGridSize, cellSize) : null, [gpu])
    const renderSim = useMemo(() => gpu ? makeRenderSimulatorCanvas(gpu, initialGridSize) : null, [gpu])

    useEffect(() => {
        if (renderSim) {
            renderSim.setOutput(canvasSize)
        }

        if (simulator) {
            simulator.setGridSize(gridSize)
        }
    }, [renderSim, simulator, canvasSize, gridSize])

    const [brushSize, setBrushSize] = useState(defaultSignalBrushSize)
    const [brushValue, setBrushValue] = useState(defaultSignalBrushValue)
    const [signalFrequency, setSignalFrequency] = useState(1)
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
            drawCanvasRef.current!.width = window.innerWidth
            drawCanvasRef.current!.height = window.innerHeight

            const simData = simulator.getData()

            if (mouseDownPos.current !== null) {
                const centerX = clamp(0, gridSize[0] - 1, Math.floor(gridSize[0] * mouseDownPos.current[0] / canvasSize[0]))
                const centerY = clamp(0, gridSize[1] - 1, Math.floor(gridSize[1] * mouseDownPos.current[1] / canvasSize[1]))
                const brushHalfSize = Math.round(brushSize / 2)

                simulator.injectSignal([centerX, centerY], brushHalfSize, -brushValue * 1000 * Math.cos(2 * Math.PI * signalFrequency * simData.time), dt)
            }

            simulator.stepMagnetic(dt)
            simulator.stepElectric(dt)
        }
    }, [simulator, canvasSize, gridSize, signalFrequency, brushValue, brushSize, drawCanvasRef])

    useEffect(() => {
        const timer = setInterval(simStep, 1000 * dt)
        return () => clearInterval(timer)
    }, [simStep])

    const drawStep = useCallback(() => {
        if (simulator && renderSim) {
            const simData = simulator.getData()

            if (simData.time > 0) {
                renderSim(simData.electricFieldX.values, simData.electricFieldY.values, simData.electricFieldZ.values,
                    simData.magneticFieldX.values, simData.magneticFieldY.values, simData.magneticFieldZ.values,
                    simData.permittivity.values, simData.permeability.values, gridSize)
            }
        }
    }, [simulator, renderSim, gridSize])

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
        <div>
            <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef} style={{ position: "absolute", userSelect: "none" }}
                onMouseDown={e => onInputDown([e.clientX, e.clientY])}
                onMouseMove={e => { setMousePosition([e.clientX, e.clientY]); onInputMove([e.clientX, e.clientY]) }}
                onMouseUp={e => onInputUp()}
                onTouchStart={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputDown([e.touches[0].clientX, e.touches[0].clientY]) }}
                onTouchMove={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputMove([e.touches[0].clientX, e.touches[0].clientY]) }}
                onTouchEnd={e => { setMousePosition(null); onInputUp() }}
                onContextMenu={e => e.preventDefault()}
            />

            <div style={{ position: "absolute", bottom: 10, right: 10, userSelect: "none" }}>
                <a href="https://github.com/RobinKa/maxwell-simulation" rel="noopener noreferrer" target="_blank" style={{ fontWeight: "lighter", color: "rgba(255, 255, 255, 100)", textDecoration: "none" }}>Source code</a>
            </div>

            {mousePosition &&
                <div style={{ position: "absolute", pointerEvents: "none", left: mousePosition[0] - (2 * (brushSize + 1)), top: mousePosition[1] - (2 * (brushSize + 1)), width: 4 * (brushSize + 1), height: 4 * (brushSize + 1), border: "2px solid yellow" }} />
            }

            <ControlWidget simulator={simulator} gridSize={gridSize}
                gridSizeLongest={gridSizeLongest} setGridSizeLongest={setGridSizeLongest}
                brushSize={brushSize} setBrushSize={setBrushSize}
                brushValue={brushValue} setBrushValue={setBrushValue}
                signalFrequency={signalFrequency} setSignalFrequency={setSignalFrequency}
                clickOption={clickOption} setClickOption={setClickOption}
                resetFields={resetFields} resetMaterials={resetMaterials}
            />
        </div>
    )
}
