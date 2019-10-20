import React, { useRef, useCallback, useEffect, useState } from 'react'
import { GPU, IKernelRunShortcut } from "gpu.js"
import { FDTDSimulator, addScalarField3DValue, FlatScalarField3D, setScalarField3DValue } from "./simulator"

const canvasSize = [window.innerWidth, window.innerHeight]
const canvasAspect = canvasSize[0] / canvasSize[1]

const dt = 0.02
const gridSizeLongest = 600
const gridSize: [number, number, number] = canvasSize[0] >= canvasSize[1] ?
    [gridSizeLongest, Math.ceil(gridSizeLongest / canvasAspect), 1] :
    [Math.ceil(gridSizeLongest * canvasAspect), gridSizeLongest, 1]
const cellSize = 0.04

const simulator = new FDTDSimulator(gridSize, cellSize)

const makeRenderSimulatorCanvas = (g: GPU) => {
    function getAt(field: number[], shapeX: number, shapeY: number, shapeZ: number, x: number, y: number, z: number) {
        if (x < 0 || x >= shapeX || y < 0 || y >= shapeY || z < 0 || z >= shapeZ) {
            return 0
        }

        return field[x + y * shapeX + z * shapeX * shapeZ]
    }

    return g.createKernel(function (electricFieldX: number[], electricFieldY: number[], electricFieldZ: number[],
        magneticFieldX: number[], magneticFieldY: number[], magneticFieldZ: number[],
        permittivity: number[], permeability: number[]) {
        const gx = this.constants.gridSizeX as number
        const gy = this.constants.gridSizeY as number
        const gz = this.constants.gridSizeZ as number

        const x = gx * this.thread.x! / (this.output.x as number)
        const y = gy * (1 - this.thread.y! / (this.output.y as number))
        const xa = Math.floor(x)
        const ya = Math.floor(y)

        const z = Math.floor(gz / 2)

        const eAA = getAt(electricFieldX, gx, gy, gz, xa, ya, z) * getAt(electricFieldX, gx, gy, gz, xa, ya, z) + getAt(electricFieldY, gx, gy, gz, xa, ya, z) * getAt(electricFieldY, gx, gy, gz, xa, ya, z) + getAt(electricFieldZ, gx, gy, gz, xa, ya, z) * getAt(electricFieldZ, gx, gy, gz, xa, ya, z)

        // Magnetic field is offset from electric field, so get value at +0.5 by interpolating 0 and 1
        const magXAA = (getAt(magneticFieldX, gx, gy, gz, xa, ya, z) + getAt(magneticFieldX, gx, gy, gz, xa - 1, ya - 1, z)) / 2
        const magYAA = (getAt(magneticFieldY, gx, gy, gz, xa, ya, z) + getAt(magneticFieldY, gx, gy, gz, xa - 1, ya - 1, z)) / 2
        const magZAA = (getAt(magneticFieldZ, gx, gy, gz, xa, ya, z) + getAt(magneticFieldZ, gx, gy, gz, xa - 1, ya - 1, z)) / 2

        const mAA = magXAA * magXAA + magYAA * magYAA + magZAA * magZAA

        const scale = 15

        const permittivityValue = Math.max(0, Math.min(1, (1 + 0.4342944819 * Math.log(getAt(permittivity, gx, gy, gz, xa, ya, z))) / 4))
        const permeabilityValue = Math.max(0, Math.min(1, (1 + 0.4342944819 * Math.log(getAt(permeability, gx, gy, gz, xa, ya, z))) / 4))

        const backgroundX = (Math.abs(x % 1 - 0.5) < 0.25 ? 1 : 0) * (Math.abs(y % 1 - 0.5) < 0.25 ? 1 : 0)
        const backgroundY = 1 - backgroundX

        this.color(eAA / scale + 0.5 * backgroundX * permittivityValue, eAA / scale + mAA / scale, mAA / scale + 0.5 * backgroundY * permeabilityValue)
    }, {
        output: [canvasSize[0], canvasSize[1]],
        constants: { gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] },
        graphical: true
    }).setFunctions([getAt]).setWarnVarUsage(false)
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
    brushSize: number,
    setBrushSize: (brushSize: number) => void

    brushValue: number,
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

    return (
        <div style={{ userSelect: "none" }}>
            <div style={{ textAlign: "center", position: "absolute", opacity: 0.8, background: "rgba(33, 33, 33, 100)", fontWeight: "lighter", color: "white" }}>
                <button onClick={e => setCollapsed(!collapsed)} style={{ width: "100%", height: "30px", background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", fontWeight: "bold", cursor: "pointer" }}>
                    Controls [{collapsed ? "+" : "-"}]
                </button>
                {!collapsed && (
                    <div style={{ padding: "10px" }}>
                        <LabeledSlider label="Brush size" value={props.brushSize} setValue={props.setBrushSize} min={0} max={100} step={1} />
                        <LabeledSlider label="Brush value" value={props.brushValue} setValue={props.setBrushValue} min={1} max={100} step={1} />
                        <LabeledSlider label="Signal frequency" value={props.signalFrequency} setValue={props.setSignalFrequency} min={0.5} max={5} step={0.5} />
                        <OptionSelector options={["ε brush", "µ brush", "Signal"]} selectedOption={props.clickOption} setSelectedOption={props.setClickOption} />
                        <button onClick={props.resetFields} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Reset fields</button>
                        <button onClick={props.resetMaterials} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Reset materials</button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function () {
    const [brushSize, setBrushSize] = useState(5)
    const [brushValue, setBrushValue] = useState(5)
    const [signalFrequency, setSignalFrequency] = useState(1)
    const [drawingPermeability, setDrawingPermeability] = useState(false)
    const [drawingPermittivity, setDrawingPermittivity] = useState(false)
    const [clickOption, setClickOption] = useState(2) // eps, mu, signal
    const optionPermittivityBrush = 0
    const optionPermeabilityBrush = 1
    const optionSignal = 2

    const signalPosition = useRef([0, 0])
    const signalStrength = useRef(0)
    const mouseDownPos = useRef<[number, number] | null>(null)
    const renderSim = useRef<IKernelRunShortcut | null>(null)
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const simStep = useCallback(() => {
        const simData = simulator.getData()

        if (mouseDownPos.current !== null) {
            signalPosition.current = mouseDownPos.current
            signalStrength.current = Math.min(10000, signalStrength.current + dt * 10000)
        }

        signalStrength.current *= Math.pow(0.1, dt)

        if (signalStrength.current > 1 && drawCanvasRef.current) {
            const px = clamp(0, simData.electricFieldX.shape[0] - 1, Math.floor(simData.electricFieldX.shape[0] * signalPosition.current[0] / drawCanvasRef.current.width))
            const py = clamp(0, simData.electricFieldX.shape[1] - 1, Math.floor(simData.electricFieldX.shape[1] * signalPosition.current[1] / drawCanvasRef.current.height))

            for (let z = 0; z < simData.electricFieldX.shape[2]; z++) {
                addScalarField3DValue(simData.electricFieldZ, px, py, z, Math.sin(signalFrequency * 2 * Math.PI * simData.time) * signalStrength.current * dt)
            }
        }

        simulator.stepMagnetic(dt)
        simulator.stepElectric(dt)
    }, [signalFrequency])

    useEffect(() => {
        const timer = setInterval(simStep, 1000 * dt)
        return () => clearInterval(timer)
    }, [simStep])

    const startLoop = useCallback(() => {
        let stop = false

        const loop = (async () => {
            const resolveDrawPromise = (resolve: (value?: unknown) => void) => requestAnimationFrame(resolve)

            while (!stop) {
                const simData = simulator.getData()

                if (simData.time > 0 && renderSim.current !== null) {
                    renderSim.current(simData.electricFieldX.values, simData.electricFieldY.values, simData.electricFieldZ.values,
                        simData.magneticFieldX.values, simData.magneticFieldY.values, simData.magneticFieldZ.values,
                        simData.permittivity.values, simData.permeability.values)
                }

                await new Promise(resolveDrawPromise)
            }
        })

        loop()

        return () => { stop = true }
    }, [])

    useEffect(() => {
        if (drawCanvasRef.current) {
            renderSim.current = makeRenderSimulatorCanvas(new GPU({ mode: "webgl2", canvas: drawCanvasRef.current }))
        } else {
            throw new Error("Canvas ref was null")
        }

        startLoop()
    }, [startLoop])

    const changeMaterial = useCallback((field: FlatScalarField3D, canvasPos: [number, number]) => {
        const centerX = Math.round(gridSize[0] * (canvasPos[0] / canvasSize[0]))
        const centerY = Math.round(gridSize[1] * (canvasPos[1] / canvasSize[1]))
        const brushHalfSize = Math.round(brushSize / 2)

        for (let x = Math.max(0, centerX - brushHalfSize); x <= Math.min(gridSize[0] - 1, centerX + brushHalfSize); x++) {
            for (let y = Math.max(0, centerY - brushHalfSize); y <= Math.min(gridSize[1] - 1, centerY + brushHalfSize); y++) {
                setScalarField3DValue(field, x, y, 0, brushValue)
            }
        }
    }, [brushSize, brushValue])

    const resetMaterials = useCallback(() => {
        simulator.resetMaterials()
    }, [])

    const resetFields = useCallback(() => {
        simulator.resetFields()
        signalStrength.current = 0
    }, [])

    const onInputDown = useCallback(([clientX, clientY]: [number, number]) => {
        if (clickOption === optionSignal) {
            mouseDownPos.current = [clientX, clientY]
        } else if (clickOption === optionPermittivityBrush) {
            changeMaterial(simulator.getData().permittivity, [clientX, clientY])
            setDrawingPermittivity(true)
        } else if (clickOption === optionPermeabilityBrush) {
            changeMaterial(simulator.getData().permeability, [clientX, clientY])
            setDrawingPermeability(true)
        }
    }, [changeMaterial, clickOption])

    const onInputMove = useCallback(([clientX, clientY]: [number, number]) => {
        if (clickOption === optionSignal && mouseDownPos.current !== null) {
            mouseDownPos.current = [clientX, clientY]
        }

        if (drawingPermittivity) {
            changeMaterial(simulator.getData().permittivity, [clientX, clientY])
        }

        if (drawingPermeability) {
            changeMaterial(simulator.getData().permeability, [clientX, clientY])
        }
    }, [changeMaterial, clickOption, drawingPermeability, drawingPermittivity])

    const onInputUp = useCallback(([clientX, clientY]: [number, number]) => {
        if (clickOption === optionSignal) {
            mouseDownPos.current = null
        } else if (clickOption === optionPermeabilityBrush) {
            setDrawingPermeability(false)
        } else if (clickOption === optionPermittivityBrush) {
            setDrawingPermittivity(false)
        }
    }, [clickOption])

    return (
        <div>
            <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef} style={{ position: "absolute" }}
                onMouseDown={e => onInputDown([e.clientX, e.clientY])}
                onMouseMove={e => onInputMove([e.clientX, e.clientY])}
                onMouseUp={e => onInputUp([e.clientX, e.clientY])}
                onTouchStart={e => onInputDown([e.touches[0].clientX, e.touches[0].clientY])}
                onTouchMove={e => onInputMove([e.touches[0].clientX, e.touches[0].clientY])}
                onTouchEnd={e => onInputUp([e.touches[0].clientX, e.touches[0].clientY])}
                onContextMenu={e => e.preventDefault()}
            />

            <div style={{ position: "absolute", bottom: 10, right: 10, userSelect: "none" }}>
                <a href="https://github.com/RobinKa/maxwell-simulation" rel="noopener noreferrer" target="_blank" style={{ fontWeight: "lighter", color: "rgba(255, 255, 255, 100)", textDecoration: "none" }}>Source code</a>
            </div>

            <ControlWidget brushSize={brushSize} setBrushSize={setBrushSize}
                brushValue={brushValue} setBrushValue={setBrushValue}
                signalFrequency={signalFrequency} setSignalFrequency={setSignalFrequency}
                clickOption={clickOption} setClickOption={setClickOption}
                resetFields={resetFields} resetMaterials={resetMaterials}
            />
        </div>
    )
}
