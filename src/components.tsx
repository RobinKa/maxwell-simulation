import React, { ReactElement, useState, useCallback, useMemo, useRef, useEffect, MouseEventHandler } from "react"
import { SimulatorMap, SimulationSettings } from "./serialization"
import { FDTDSimulator, DrawShapeType } from "./simulator"
import { SignalSource, PointSignalSource } from "./sources"
import * as maps from "./maps"
import { QualityPreset } from "./util"

export type CollapsibleContainerProps = {
    children?: ReactElement<any> | ReactElement<any>[]
    id?: string
    className?: string
    style?: React.CSSProperties
    buttonStyle?: React.CSSProperties
    title?: string
    collapsed: boolean
    setCollapsed: (collapsed: boolean) => void
}

export function CollapsibleContainer(props: CollapsibleContainerProps) {
    const { collapsed, setCollapsed, id, className, buttonStyle, style, children, title } = props

    return (
        <div id={id} className={className} style={{ textAlign: "center", background: "rgb(33, 33, 33)", fontWeight: "lighter", color: "white", height: "400px", ...style }}>
            <button onClick={e => setCollapsed(!collapsed)} style={{ width: "30px", float: "left", height: "100%", background: "rgb(50, 50, 50)", border: "0px", color: "white", fontWeight: "bold", fontSize: "20px", cursor: "pointer", ...buttonStyle }}>
                {collapsed ? "<" : ">"}
            </button>
            <div style={{ float: "right" }}>
                {!collapsed && (<div>
                    <div style={{ fontSize: "20px", marginTop: "4px" }}>{title}</div>
                    {children}
                </div>)}
            </div>
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
            {allowNegative && <>
                <input style={{ marginLeft: "10px" }} type="checkbox" checked={negative} onChange={e => setNegative(e.target.checked)} /><label>Negative</label>
            </>}
            <div>
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
    style?: React.CSSProperties
    buttonStyle?: React.CSSProperties
}

export function OptionSelector(props: OptionSelectorProps) {
    return (
        <div style={props.style}>
            {props.options.map((option, optionIndex) =>
                <button key={option} style={{
                    backgroundColor: "rgb(50, 50, 50)",
                    color: "white",
                    border: optionIndex === props.selectedOption ? "3px solid rgb(0, 150, 255)" : "0",
                    height: "30px",
                    width: "70px",
                    overflow: "hidden",
                    textOverflow: "hidden",
                    ...props.buttonStyle
                }}
                    onClick={e => props.setSelectedOption(optionIndex)}>
                    {option}
                </button>
            )}
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

        const loadedSources = simulatorMap.sourceDescriptors.map(desc => {
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
        <div style={{ padding: "5px", width: "150px" }}>
            <div><button onClick={_ => loadMap(maps.empty(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", width: "100%", border: "0px", color: "white", margin: "2px" }}>Empty</button></div>
            <div><button onClick={_ => loadMap(maps.doubleSlit(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", width: "100%", border: "0px", color: "white", margin: "2px" }}>Double slit</button></div>
            <div><button onClick={_ => loadMap(maps.fiberOptics(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", width: "100%", border: "0px", color: "white", margin: "2px" }}>Fiber optics</button></div>
            <div><button onClick={_ => loadMap(maps.lens(simulationSettings))} style={{ backgroundColor: "rgb(50, 50, 50)", width: "100%", border: "0px", color: "white", margin: "2px" }}>Lens</button></div>
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

    qualityPresets: { [presetName: string]: QualityPreset }
}

export function SettingsComponent(props: SettingsComponentProps) {
    const { qualityPresets, setCellSize, setGridSizeLongest, setResolutionScale, setDt } = props

    const onPresetClicked = useCallback((preset: QualityPreset) => {
        setCellSize(preset.cellSize)
        setGridSizeLongest(preset.gridSizeLongest)
        setResolutionScale(preset.resolutionScale)
        setDt(preset.dt)
    }, [setCellSize, setGridSizeLongest, setResolutionScale, setDt])

    return (
        <div style={{ padding: "5px" }}>
            <div>Quality presets</div>
            <div>
                {Object.keys(qualityPresets).map(presetName =>
                    <button key={presetName} onClick={_ => onPresetClicked(qualityPresets[presetName])}
                        style={{ backgroundColor: "rgb(50, 50, 50)", border: "0px", color: "white", margin: "2px" }}>
                        {presetName}
                    </button>
                )}
            </div>
            <LabeledSlider label="Grid length" value={props.gridSizeLongest} setValue={props.setGridSizeLongest} min={100} max={2000} step={100} />
            <LabeledSlider label="Time step size" value={props.dt} setValue={props.setDt} min={0.001} max={0.1} step={0.001} allowNegative={true} />
            <LabeledSlider label="Cell size" value={props.cellSize} setValue={props.setCellSize} min={0.002} max={0.2} step={0.001} />
            <LabeledSlider label="Resolution scale" value={props.resolutionScale} setValue={props.setResolutionScale} min={0.1} max={2} step={0.1} />
            <LabeledSlider label="Simulation speed" value={props.simulationSpeed} setValue={props.setSimulationSpeed} min={0} max={10} step={0.1} />
            <input type="checkbox" checked={props.reflectiveBoundary} onChange={e => props.setReflectiveBoundary(e.target.checked)} />Reflective boundary
        </div>
    )
}

type ImageButtonProps = {
    onClick?: MouseEventHandler<HTMLButtonElement>
    src?: string
    size?: number
    highlight?: boolean
}

export function ImageButton(props: ImageButtonProps) {
    const size = props.size || 48

    return (
        <button onClick={props.onClick} style={{ margin: "2px", padding: "5px", background: "transparent", border: props.highlight ? "2px solid rgb(0, 150, 255)" : "2px solid transparent", borderRadius: "10px", lineHeight: 0 }}>
            <img width={size} height={size} src={props.src} alt="" style={{ width: size, height: size }} />
        </button>
    )
}

export type ShareComponentProps = {
    shareUrl: string
    shareTitle: string
    shareText: string
}

export function ShareComponent(props: ShareComponentProps) {
    const { shareTitle, shareText, shareUrl } = props

    const shareUrlTextRef = useRef<HTMLInputElement>(null)

    const onCopyClicked = useCallback(() => {
        if (shareUrlTextRef.current) {
            shareUrlTextRef.current.select()
            document.execCommand("copy")
        }
    }, [shareUrlTextRef])

    const onShareClicked = useCallback(() => {
        const nav = navigator as any
        if (nav.share) {
            nav.share({
                title: shareTitle,
                text: shareText,
                url: shareUrl
            }).then(() => console.log("Shared")).catch((err: any) => console.error(`Share failed: ${err}`))
        }
    }, [shareUrl, shareTitle, shareText])

    return (
        <div style={{ padding: "5px" }}>
            {shareUrl &&
                <>
                    <div>
                        <input ref={shareUrlTextRef} readOnly type="text" value={shareUrl} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px", width: "70%" }} />
                        <button onClick={onCopyClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", margin: "2px" }}>Copy</button>
                    </div>
                    <div>
                        {(navigator as any).share !== undefined && <button onClick={onShareClicked} style={{ background: "rgba(50, 50, 50, 100)", border: "0px", width: "80%", fontSize: "24px", color: "white", margin: "2px" }}>Share</button>}
                    </div>
                </>
            }
        </div>
    )
}

export type MaterialBrushMenuProps = {
    materialBrushSize: number
    setMaterialBrushSize: (brushSize: number) => void

    permeabilityBrushValue: number
    setPermeabilityBrushValue: (brushValue: number) => void

    permittivityBrushValue: number
    setPermittivityBrushValue: (brushValue: number) => void

    conductivityBrushValue: number
    setConductivityBrushValue: (brushValue: number) => void

    drawShapeType: DrawShapeType
    setDrawShapeType: (drawShapeType: DrawShapeType) => void

    snapInput: boolean
    setSnapInput: (snapInput: boolean) => void
}

export function MaterialBrushMenu(props: MaterialBrushMenuProps) {
    const { drawShapeType, setDrawShapeType } = props

    const drawShapeTypeIndex = useMemo(() => drawShapeType === "square" ? 0 : 1, [drawShapeType])
    const setDrawShapeTypeIndex = useCallback((index: number) => setDrawShapeType(index === 0 ? "square" : "circle"), [setDrawShapeType])

    const brushSizeLabel = useMemo(() => drawShapeType === "square" ? "Brush size" : "Brush radius", [drawShapeType])

    return (
        <div style={{ padding: "10px" }}>
            <input type="checkbox" checked={props.snapInput} onChange={e => props.setSnapInput(e.target.checked)} /><label>Snap to 45° line</label>
            <OptionSelector buttonStyle={{ height: "24px" }} options={["Square", "Circle"]} selectedOption={drawShapeTypeIndex} setSelectedOption={setDrawShapeTypeIndex} />
            <div>
                <LabeledSlider label={brushSizeLabel} value={props.materialBrushSize} setValue={props.setMaterialBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="ε value" value={props.permittivityBrushValue} setValue={props.setPermittivityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
                <LabeledSlider label="µ value" value={props.permeabilityBrushValue} setValue={props.setPermeabilityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
                <LabeledSlider label="σ value" value={props.conductivityBrushValue} setValue={props.setConductivityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
            </div>
        </div>
    )
}

export type SignalBrushMenuProps = {
    signalBrushSize: number
    setSignalBrushSize: (brushSize: number) => void

    signalBrushValue: number
    setSignalBrushValue: (brushValue: number) => void

    signalFrequency: number
    setSignalFrequency: (signalFrequency: number) => void

    drawShapeType: DrawShapeType
    setDrawShapeType: (drawShapeType: DrawShapeType) => void

    snapInput: boolean
    setSnapInput: (snapInput: boolean) => void
}

export function SignalBrushMenu(props: SignalBrushMenuProps) {
    const { drawShapeType, setDrawShapeType } = props

    const drawShapeTypeIndex = useMemo(() => drawShapeType === "square" ? 0 : 1, [drawShapeType])
    const setDrawShapeTypeIndex = useCallback((index: number) => setDrawShapeType(index === 0 ? "square" : "circle"), [setDrawShapeType])

    const brushSizeLabel = useMemo(() => drawShapeType === "square" ? "Brush size" : "Brush radius", [drawShapeType])

    return (
        <div style={{ padding: "10px" }}>
            <input type="checkbox" checked={props.snapInput} onChange={e => props.setSnapInput(e.target.checked)} /><label>Snap to 45° line</label>
            <OptionSelector buttonStyle={{ height: "24px" }} options={["Square", "Circle"]} selectedOption={drawShapeTypeIndex} setSelectedOption={setDrawShapeTypeIndex} />
            <div>
                <LabeledSlider label={brushSizeLabel} value={props.signalBrushSize} setValue={props.setSignalBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="Signal amplitude" value={props.signalBrushValue} setValue={props.setSignalBrushValue} min={1} max={100} step={1} />
                <LabeledSlider label="Signal frequency" value={props.signalFrequency} setValue={props.setSignalFrequency} min={0} max={25} step={0.25} />
            </div>
        </div>
    )
}