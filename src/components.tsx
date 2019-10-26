import React, { ReactElement, useState, useCallback, useMemo, useRef, useEffect } from "react"
import { encodeMaterialMap, decodeMaterialMap, SimulatorMap, SimulationSettings } from "./serialization"
import { FDTDSimulator, DrawShapeType } from "./simulator"
import { SignalSource, PointSignalSource } from "./sources"
import * as maps from "./maps"

export type CollapsibleContainerProps = {
    children: ReactElement<any> | ReactElement<any>[] | null
    id?: string
    className?: string
    style?: React.CSSProperties
    buttonStyle?: React.CSSProperties
    title?: string
    initiallyCollapsed?: boolean
}

export function CollapsibleContainer(props: CollapsibleContainerProps) {
    const [collapsed, setCollapsed] = useState(props.initiallyCollapsed !== undefined ? props.initiallyCollapsed : false)

    return (
        <div id={props.id} className={props.className} style={{ textAlign: "center", background: "rgb(33, 33, 33)", fontWeight: "lighter", color: "white", ...props.style }}>
            <button onClick={e => setCollapsed(!collapsed)} style={{ width: "100%", height: "24px", background: "rgb(50, 50, 50)", border: "0px", color: "white", fontWeight: "bold", cursor: "pointer", ...props.buttonStyle }}>
                {props.title ? `${props.title} ` : ""}[{collapsed ? "+" : "-"}]
            </button>
            {!collapsed && props.children}
        </div>
    )
}

export type LabeledSliderProps = {
    label: string
    value: number,
    setValue: (value: number) => void
    min: number
    max: number
    step: number
    allowNegative?: boolean
    logarithmic?: boolean
    displayDigits?: number
}

export function LabeledSlider(props: LabeledSliderProps) {
    const { value, setValue, allowNegative, logarithmic, displayDigits } = props
    const absValue = logarithmic ? Math.log2(Math.abs(value)) : Math.abs(value)

    const [negative, setNegative] = useState(value < 0)

    const rangeSliderRef = useRef<HTMLInputElement>(null)

    const updateValue = useCallback(() => {
        if (rangeSliderRef.current) {
            let newValue = parseFloat(rangeSliderRef.current.value)
            if (logarithmic) {
                newValue = Math.pow(2, newValue)
            }

            setValue((negative ? -1 : 1) * newValue)
        }
    }, [setValue, negative, logarithmic, rangeSliderRef])

    useEffect(() => updateValue(), [negative, updateValue])

    const displayValue = (displayDigits !== undefined) ? value.toFixed(displayDigits) : value

    return (
        <div>
            <label>{props.label}</label>
            <div>
                {allowNegative && <>
                    <input type="checkbox" checked={negative} onChange={e => setNegative(e.target.checked)} /><label>Negative</label>
                </>}
                <input type="range" ref={rangeSliderRef} min={props.min} max={props.max} value={absValue} step={props.step}
                    onChange={updateValue} style={{ height: 10, width: "100%" }} />
                <div style={{ textAlign: "center", lineHeight: 0.2, marginBottom: "7px" }}>
                    {displayValue}
                </div>
            </div>
        </div>
    )
}

export type OptionSelectorProps = {
    options: string[]
    selectedOption: number
    setSelectedOption: (selectedOption: number) => void
    buttonClassName?: string
}

export function OptionSelector(props: OptionSelectorProps) {
    return (
        <div style={{ margin: "10px" }}>
            {props.options.map((option, optionIndex) =>
                <button className={props.buttonClassName} key={option} style={{
                    backgroundColor: "rgb(50, 50, 50)",
                    color: "white",
                    border: optionIndex === props.selectedOption ? "3px solid rgb(0, 150, 255)" : "0",
                    height: "30px",
                    width: "70px",
                    overflow: "hidden",
                    textOverflow: "hidden"
                }}
                    onClick={e => props.setSelectedOption(optionIndex)}>
                    {option}
                </button>
            )}
        </div>
    )
}

export type SaveLoadComponentProps = {
    simulator: FDTDSimulator | null
    gridSize: [number, number]
}

export function SaveLoadComponent(props: SaveLoadComponentProps) {
    const simulator = props.simulator
    const gridSize = props.gridSize
    const [simulatorMapUrl, setSimulatorMapUrl] = useState("")

    const onSaveClicked = useCallback(() => {
        if (simulator) {
            const simData = simulator.getData()

            window.open(encodeMaterialMap({
                permittivity: simData.permittivity.values.toArray() as number[][],
                permeability: simData.permeability.values.toArray() as number[][],
                shape: [simData.permeability.shape[0], simData.permeability.shape[1]]
            }))
        }
    }, [simulator])

    const onLoadClicked = useCallback(() => {
        if (simulator) {
            decodeMaterialMap(simulatorMapUrl, [gridSize[0], gridSize[1]], map => {
                if (simulator) {
                    simulator.loadPermeability(map.permeability)
                    simulator.loadPermittivity(map.permittivity)
                }
            })
        }
    }, [simulator, gridSize, simulatorMapUrl])

    return (
        <div style={{ padding: "10px" }}>
            <div>
                <button onClick={onSaveClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Save map</button>
            </div>
            <div>
                <input type="text" onChange={e => setSimulatorMapUrl(e.target.value)} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }} />
                <button onClick={onLoadClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Load map url</button>
            </div>
        </div>
    )
}

export type ExamplesComponentProps = {
    simulator: FDTDSimulator | null

    dt: number
    simulationSpeed: number
    cellSize: number
    gridSize: [number, number]

    setGridSizeLongest: (gridSizeLongest: number) => void
    setDt: (dt: number) => void
    setCellSize: (cellSize: number) => void
    setSimulationSpeed: (simulationSpeed: number) => void
    setSources: (sources: SignalSource[]) => void
}

export function ExamplesComponent(props: ExamplesComponentProps) {
    const { simulator, setGridSizeLongest, setDt, setCellSize, setSimulationSpeed, setSources } = props

    const loadMap = useCallback((simulatorMap: SimulatorMap) => {
        if (simulator) {
            simulator.resetFields()
            simulator.loadPermeability(simulatorMap.materialMap.permeability)
            simulator.loadPermittivity(simulatorMap.materialMap.permittivity)
        }

        const loadedSources = simulatorMap.sourcesDescriptors.map(desc => {
            if (desc.type === "point") {
                return new PointSignalSource(desc.amplitude, desc.frequency, desc.position, desc.turnOffTime)
            }

            throw new Error(`Unsupported source type: ${desc.type}`)
        })

        setCellSize(simulatorMap.simulationSettings.cellSize)
        setDt(simulatorMap.simulationSettings.dt)
        setSimulationSpeed(simulatorMap.simulationSettings.simulationSpeed)
        setGridSizeLongest(Math.max(simulatorMap.simulationSettings.gridSize[0], simulatorMap.simulationSettings.gridSize[1]))
        setSources(loadedSources)
    }, [simulator, setCellSize, setDt, setSimulationSpeed, setGridSizeLongest, setSources])

    const simulationSettings = useMemo<SimulationSettings>(() => {
        return {
            dt: props.dt,
            cellSize: props.cellSize,
            gridSize: props.gridSize,
            simulationSpeed: props.simulationSpeed
        }
    }, [props.dt, props.cellSize, props.gridSize, props.simulationSpeed])

    return (
        <div style={{ padding: "10px" }}>
            <button onClick={_ => loadMap(maps.empty(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px" }}>Empty</button>
            <button onClick={_ => loadMap(maps.doubleSlit(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px" }}>Double slit</button>
            <button onClick={_ => loadMap(maps.fiberOptics(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px" }}>Fiber optics</button>
            <button onClick={_ => loadMap(maps.lens(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px" }}>Lens</button>
        </div>
    )
}

export type SettingsComponentProps = {
    gridSizeLongest: number
    setGridSizeLongest: (gridSizeLongest: number) => void

    dt: number
    setDt: (dt: number) => void

    cellSize: number
    setCellSize: (cellSize: number) => void

    resolutionScale: number
    setResolutionScale: (resolutionScale: number) => void

    simulationSpeed: number
    setSimulationSpeed: (simulationSpeed: number) => void

    reflectiveBoundary: boolean
    setReflectiveBoundary: (reflectiveBoundary: boolean) => void
}

export function SettingsComponent(props: SettingsComponentProps) {
    return (
        <div style={{ padding: "10px" }}>
            <LabeledSlider label="Grid length" value={props.gridSizeLongest} setValue={props.setGridSizeLongest} min={100} max={2000} step={100} />
            <LabeledSlider label="Time step size" value={props.dt} setValue={props.setDt} min={0.001} max={0.1} step={0.001} allowNegative={true} />
            <LabeledSlider label="Cell size" value={props.cellSize} setValue={props.setCellSize} min={0.002} max={0.2} step={0.001} />
            <LabeledSlider label="Resolution scale" value={props.resolutionScale} setValue={props.setResolutionScale} min={0.1} max={2} step={0.1} />
            <LabeledSlider label="Simulation speed" value={props.simulationSpeed} setValue={props.setSimulationSpeed} min={0} max={10} step={0.1} />
            <input type="checkbox" checked={props.reflectiveBoundary} onChange={e => props.setReflectiveBoundary(e.target.checked)} />Reflective boundary
        </div>
    )
}

export type ControlComponentProps = {
    signalBrushSize: number,
    setSignalBrushSize: (brushSize: number) => void

    signalBrushValue: number
    setSignalBrushValue: (brushValue: number) => void

    materialBrushSize: number,
    setMaterialBrushSize: (brushSize: number) => void

    permeabilityBrushValue: number
    setPermeabilityBrushValue: (brushValue: number) => void

    permittivityBrushValue: number
    setPermittivityBrushValue: (brushValue: number) => void

    signalFrequency: number,
    setSignalFrequency: (signalFrequency: number) => void

    clickOption: number
    setClickOption: (clickOption: number) => void

    resetFields: () => void
    resetMaterials: () => void

    drawShapeType: DrawShapeType
    setDrawShapeType: (drawShapeType: DrawShapeType) => void
}

export function ControlComponent(props: ControlComponentProps) {
    const showSignal = props.clickOption === 1

    const { drawShapeType, setDrawShapeType } = props

    const drawShapeTypeIndex = useMemo(() => drawShapeType === "square" ? 0 : 1, [drawShapeType])
    const setDrawShapeTypeIndex = useCallback((index: number) => setDrawShapeType(index === 0 ? "square" : "circle"), [setDrawShapeType])

    const brushSizeLabel = useMemo(() => drawShapeType === "square" ? "Brush size" : "Brush radius", [drawShapeType])

    return (
        <div style={{ padding: "10px" }}>
            <div style={{ display: showSignal ? undefined : "none" }}>
                <LabeledSlider label={brushSizeLabel} value={props.signalBrushSize} setValue={props.setSignalBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="Signal amplitude" value={props.signalBrushValue} setValue={props.setSignalBrushValue} min={1} max={500} step={1} />
                <LabeledSlider label="Signal frequency" value={props.signalFrequency} setValue={props.setSignalFrequency} min={0} max={25} step={0.25} />
            </div>
            <div style={{ display: !showSignal ? undefined : "none" }}>
                <LabeledSlider label={brushSizeLabel} value={props.materialBrushSize} setValue={props.setMaterialBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="ε value" value={props.permittivityBrushValue} setValue={props.setPermittivityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
                <LabeledSlider label="µ value" value={props.permeabilityBrushValue} setValue={props.setPermeabilityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
            </div>
            <OptionSelector options={["Square", "Circle"]} selectedOption={drawShapeTypeIndex} setSelectedOption={setDrawShapeTypeIndex} />
            <OptionSelector options={["Material", "Signal"]} selectedOption={props.clickOption} setSelectedOption={props.setClickOption} />
            <div>
                <button onClick={props.resetFields} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px", width: "130px" }}>Reset fields</button>
                <button onClick={props.resetMaterials} style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px", width: "130px" }}>Reset materials</button>
            </div>
        </div>
    )
}