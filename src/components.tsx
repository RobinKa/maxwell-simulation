import React, { ReactElement, useState, useCallback, useMemo, useRef, useEffect, MouseEventHandler } from "react"
import { SimulatorMap, SimulationSettings } from "./em/serialization"
import { EMState } from "./em"
import { DrawShape, makeDrawSquareInfo, makeDrawEllipseInfo } from "./em/drawing"
import { PointSignalSource } from "./em/sources"
import * as maps from "./em/maps"
import { QualityPreset, toggleFullScreen } from "./util"
import { BounceLoader } from "react-spinners"
import * as Icon from "./icons"

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
        <div id={id} className={className} style={{
            textAlign: "center", background: "rgb(33, 33, 33)",
            fontWeight: "lighter", color: "white", height: "400px", ...style
        }}>
            <button onClick={e => setCollapsed(!collapsed)} style={{
                width: "30px", float: "left", height: "100%", background: "rgb(50, 50, 50)",
                border: "0px", color: "white", fontWeight: "bold", fontSize: "20px",
                cursor: "pointer", ...buttonStyle
            }}>
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
                <input style={{ marginLeft: "10px" }} type="checkbox" checked={negative} onChange={e => setNegative(e.target.checked)} />
                <label>Negative</label>
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
    em: EMState | null

    dt: number
    simulationSpeed: number
    cellSize: number
    gridSize: [number, number]

    setGridSizeLongest: (gridSizeLongest: number) => void
    setDt: (dt: number) => void
    setCellSize: (cellSize: number) => void
    setSimulationSpeed: (simulationSpeed: number) => void
}

export function ExamplesComponent(props: ExamplesComponentProps) {
    const { em, setGridSizeLongest, setDt, setCellSize, setSimulationSpeed } = props

    const loadMap = useCallback((simulatorMap: SimulatorMap) => {
        if (em) {
            em.resetFields()
            em.loadMaterialFromComponents(
                simulatorMap.materialMap.permittivity,
                simulatorMap.materialMap.permeability,
                simulatorMap.materialMap.conductivity
            )

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
            em.setSources(loadedSources)
        }
    }, [em, setCellSize, setDt, setSimulationSpeed, setGridSizeLongest])

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

    activeBrushShape: DrawShape
    setActiveBrushDrawShape: (drawShape: DrawShape) => void

    snapInput: boolean
    setSnapInput: (snapInput: boolean) => void
}

export function MaterialBrushMenu(props: MaterialBrushMenuProps) {
    const { activeBrushShape, setActiveBrushDrawShape } = props

    const brushShapeIndex = useMemo(() => activeBrushShape === DrawShape.Square ? 0 : 1, [activeBrushShape])
    const setBrushShapeIndex = useCallback((index: number) => setActiveBrushDrawShape(index === 0 ? DrawShape.Square : DrawShape.Ellipse), [setActiveBrushDrawShape])

    const brushSizeLabel = useMemo(() => activeBrushShape === DrawShape.Square ? "Brush size" : "Brush radius", [activeBrushShape])

    return (
        <div style={{ padding: "10px" }}>
            <input type="checkbox" checked={props.snapInput} onChange={e => props.setSnapInput(e.target.checked)} />
            <label>Snap to 45° line</label>
            <OptionSelector buttonStyle={{ height: "24px" }} options={["Square", "Circle"]}
                selectedOption={brushShapeIndex} setSelectedOption={setBrushShapeIndex} />
            <div>
                <LabeledSlider label={brushSizeLabel} value={props.materialBrushSize}
                    setValue={props.setMaterialBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="ε value" value={props.permittivityBrushValue}
                    setValue={props.setPermittivityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
                <LabeledSlider label="µ value" value={props.permeabilityBrushValue}
                    setValue={props.setPermeabilityBrushValue} min={-1} max={10} step={0.1} allowNegative={true} logarithmic={true} displayDigits={1} />
                <LabeledSlider label="σ value" value={props.conductivityBrushValue}
                    setValue={props.setConductivityBrushValue} min={0} max={20} step={0.25} allowNegative={true} />
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

    activeBrushShape: DrawShape
    setActiveBrushDrawShape: (brushShape: DrawShape) => void

    snapInput: boolean
    setSnapInput: (snapInput: boolean) => void
}

export function SignalBrushMenu(props: SignalBrushMenuProps) {
    const { activeBrushShape, setActiveBrushDrawShape } = props

    const brushShapeIndex = useMemo(() => activeBrushShape === DrawShape.Square ? 0 : 1, [activeBrushShape])
    const setBrushShapeIndex = useCallback((index: number) => setActiveBrushDrawShape(index === 0 ? DrawShape.Square : DrawShape.Ellipse), [setActiveBrushDrawShape])

    const brushSizeLabel = useMemo(() => activeBrushShape === DrawShape.Square ? "Brush size" : "Brush radius", [activeBrushShape])

    return (
        <div style={{ padding: "10px" }}>
            <input type="checkbox" checked={props.snapInput} onChange={e => props.setSnapInput(e.target.checked)} />
            <label>Snap to 45° line</label>
            <OptionSelector buttonStyle={{ height: "24px" }} options={["Square", "Circle"]}
                selectedOption={brushShapeIndex} setSelectedOption={setBrushShapeIndex} />
            <div>
                <LabeledSlider label={brushSizeLabel} value={props.signalBrushSize}
                    setValue={props.setSignalBrushSize} min={1} max={100} step={1} />
                <LabeledSlider label="Signal amplitude" value={props.signalBrushValue}
                    setValue={props.setSignalBrushValue} min={1} max={100} step={1} />
                <LabeledSlider label="Signal frequency" value={props.signalFrequency}
                    setValue={props.setSignalFrequency} min={0} max={25} step={0.25} />
            </div>
        </div>
    )
}

type MultiMenuChildProps<TState> = {
    children?: ReactElement<any>
    activateForState: TState
}

export function MultiMenuChild<TState>(props: MultiMenuChildProps<TState>) {
    return <>
        {props.children}
    </>
}

export type MultiMenuProps<TState> = {
    children?: ReactElement<MultiMenuChildProps<TState>>[]
    activeState: TState
}

export function MultiMenu<TState>(props: MultiMenuProps<TState>) {
    const activeChildren = useMemo(() => {
        return props.children?.filter(child => child.props.activateForState === props.activeState)
    }, [props.activeState, props.children])

    return <>
        {activeChildren}
    </>
}

export type InfoBoxProps = {
    visible: boolean
    setVisible: (visible: boolean) => void
}

export function InfoBox(props: InfoBoxProps) {
    return <>{props.visible &&
        <div>
            <div onClick={_ => props.setVisible(false)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
            <div style={{ position: "absolute", backgroundColor: "rgb(30, 30, 30)", left: "50%", top: "50%", marginLeft: "-150px", marginTop: "-70px", width: "300px", height: "140px", textAlign: "center", padding: "10px", color: "white", fontWeight: "lighter" }}>
                <div>
                    Made by <a href="https://github.com/RobinKa" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">Robin Kahlow</a>. If you have feedback, ideas for improvement, bug reports or anything else open an issue on <a href="https://github.com/RobinKa/maxwell-simulation/issues" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">GitHub</a> or <a href="mailto:tora@warlock.ai?subject=EM simulation feedback" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }}>send an email to tora@warlock.ai</a>.
                </div>
                <div style={{ marginTop: "5px" }}>
                    <a href="https://github.com/RobinKa/maxwell-simulation" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">
                        Source code
                    </a>
                </div>
                <div style={{ marginTop: "5px" }}>
                    Icons by <a href="https://icons8.com/" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">Icons8</a>
                </div>
            </div>
        </div>
    }</>
}

export type LoadingIndicatorProps = {
    visible: boolean
}

export function LoadingIndicator(props: LoadingIndicatorProps) {
    return <>{props.visible &&
        <div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
            <div style={{ position: "absolute", left: "50%", top: "50%", marginLeft: "-75px", marginTop: "-75px", width: "150px", height: "150px", textAlign: "center" }}>
                <BounceLoader color="rgb(0, 150, 255)" size={100} />
            </div>
        </div>
    }</>
}

export type ShareBoxProps = {
    visible: boolean
    setVisible: (visible: boolean) => void
    shareInProgress: boolean
    shareUrl: string | null
}

export function ShareBox(props: ShareBoxProps) {
    return <>{props.visible &&
        <div>
            <div onClick={_ => props.setVisible(false)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
            {!(props.shareInProgress || !props.shareUrl) &&
                <div style={{ position: "absolute", backgroundColor: "rgb(30, 30, 30)", left: "50%", top: "50%", marginLeft: "-150px", marginTop: "-30px", width: "300px", height: "60px", textAlign: "center", padding: "10px" }}>
                    <ShareComponent shareUrl={props.shareUrl} shareText="Check out what I made in this interactive web-based simulator for electromagnetic waves!" shareTitle="EM Simulator" />
                </div>
            }
        </div>
    }</>
}

type ResetButtonsProps = {
    resetMaterials: () => void
    resetFields: () => void
    extraStyle: React.CSSProperties
}

export function ResetButtons(props: ResetButtonsProps) {
    return (
        <div style={{ position: "absolute", bottom: "10px", left: "10px", ...props.extraStyle }}>
            <ImageButton onClick={props.resetFields} src={Icon.ResetFields} />
            <ImageButton onClick={props.resetMaterials} src={Icon.ResetMaterials} />
        </div>
    )
}

export enum SideBarType {
    SignalBrush = "Signal Brush",
    MaterialBrush = "Material Brush",
    Settings = "Settings",
    Examples = "Examples"
}

export enum BrushType {
    Material,
    Signal
}

type BrushSelectionButtonsProps = {
    activeSideBar: SideBarType
    setActiveSideBar: (sideBar: SideBarType) => void
    setActiveBrush: (brush: BrushType) => void
    extraStyle: React.CSSProperties
}

export function BrushSelectionButtons(props: BrushSelectionButtonsProps) {
    return (
        <div style={{ position: "absolute", top: "10px", left: "10px", ...props.extraStyle }}>
            <ImageButton onClick={_ => { props.setActiveSideBar(SideBarType.SignalBrush); props.setActiveBrush(BrushType.Signal) }} src={Icon.SignalBrush} highlight={props.activeSideBar === SideBarType.SignalBrush} />
            <ImageButton onClick={_ => { props.setActiveSideBar(SideBarType.MaterialBrush); props.setActiveBrush(BrushType.Material) }} src={Icon.MaterialBrush} highlight={props.activeSideBar === SideBarType.MaterialBrush} />
        </div>
    )
}

type MenuSelectionButtonsProps = {
    activeSideBar: SideBarType
    setActiveSideBar: (sideBar: SideBarType) => void
    extraStyle: React.CSSProperties
}

export function MenuSelectionButtons(props: MenuSelectionButtonsProps) {
    return (
        <div style={{ position: "absolute", top: "10px", right: "10px", ...props.extraStyle }}>
            <ImageButton onClick={_ => props.setActiveSideBar(SideBarType.Examples)} src={Icon.Examples} highlight={props.activeSideBar === SideBarType.Examples} />
            <ImageButton onClick={_ => props.setActiveSideBar(SideBarType.Settings)} src={Icon.Settings} highlight={props.activeSideBar === SideBarType.Settings} />
            <ImageButton onClick={toggleFullScreen} src={Icon.Fullscreen} />
        </div>
    )
}

type BrushCursorProps = {
    brushShape: DrawShape
    mousePosition: [number, number] | null
    activeBrushSize: number
}

export function BrushCursor(props: BrushCursorProps) {
    const cursorStyle = useMemo(() => {
        if (props.mousePosition) {
            const style: React.CSSProperties = {
                position: "absolute",
                pointerEvents: "none",
                left: props.mousePosition[0] - props.activeBrushSize / 2,
                top: props.mousePosition[1] - props.activeBrushSize / 2,
                width: props.activeBrushSize,
                height: props.activeBrushSize,
                border: "2px solid rgb(255, 89, 0)"
            }

            if (props.brushShape === DrawShape.Ellipse) {
                style.borderRadius = "50%"
            }

            return style
        }

        return null
    }, [props])

    return <>
        {cursorStyle && <div style={cursorStyle} />}
    </>
}

type MiscButtonsProps = {
    generateShareUrl: () => void
    shareVisible: boolean
    setShareVisible: (shareVisible: boolean) => void
    extraStyle: React.CSSProperties
    infoVisible: boolean
    setInfoVisible: (infoVisible: boolean) => void
}

export function MiscButtons(props: MiscButtonsProps) {
    return (
        <div style={{ position: "absolute", bottom: 10, right: 10, ...props.extraStyle }}>
            <ImageButton onClick={_ => { props.generateShareUrl(); props.setShareVisible(!props.shareVisible) }} src={Icon.Share} highlight={props.shareVisible} />
            <ImageButton onClick={_ => props.setInfoVisible(!props.infoVisible)} src={Icon.Info} />
            <a href="https://github.com/RobinKa/maxwell-simulation"><ImageButton src={Icon.GitHub} /></a>
        </div>
    )
}

type InteractiveCanvasProps = {
    em: EMState | null
    gridSize: [number, number]
    materialBrushSize: number
    permittivityBrushValue: number
    permeabilityBrushValue: number
    conductivityBrushValue: number
    activeBrushShape: DrawShape
    windowToSimulationPoint: (windowPoint: [number, number]) => [number, number]
    activeBrush: BrushType
    mouseDownPos: React.MutableRefObject<[number, number] | null>
    setIsInputDown: (isInputDown: boolean) => void
    snapInput: boolean
    windowSize: [number, number]
    canvasSize: [number, number]
    setMousePosition: (mousePosition: [number, number] | null) => void
    drawCanvasRef: React.RefObject<HTMLCanvasElement>
}

export function InteractiveCanvas(props: InteractiveCanvasProps) {
    const {
        em, gridSize, materialBrushSize, permittivityBrushValue,
        permeabilityBrushValue, conductivityBrushValue, activeBrushShape,
        windowToSimulationPoint, activeBrush, mouseDownPos, setIsInputDown,
        snapInput, windowSize, canvasSize, setMousePosition, drawCanvasRef
    } = props

    const changeMaterial = useCallback((canvasPos: [number, number]) => {
        if (em) {
            const center: [number, number] = windowToSimulationPoint(canvasPos)
            const brushHalfSize: [number, number] = [
                materialBrushSize / gridSize[0] / 2,
                materialBrushSize / gridSize[1] / 2
            ]

            em.drawMaterial("permittivity", activeBrushShape === DrawShape.Square ?
                makeDrawSquareInfo(center, brushHalfSize, permittivityBrushValue) :
                makeDrawEllipseInfo(center, brushHalfSize, permittivityBrushValue))

            em.drawMaterial("permeability", activeBrushShape === DrawShape.Square ?
                makeDrawSquareInfo(center, brushHalfSize, permeabilityBrushValue) :
                makeDrawEllipseInfo(center, brushHalfSize, permeabilityBrushValue))

            em.drawMaterial("conductivity", activeBrushShape === DrawShape.Square ?
                makeDrawSquareInfo(center, brushHalfSize, conductivityBrushValue) :
                makeDrawEllipseInfo(center, brushHalfSize, conductivityBrushValue))
        }
    }, [em, gridSize, materialBrushSize, permittivityBrushValue, permeabilityBrushValue, conductivityBrushValue, activeBrushShape, windowToSimulationPoint])

    const [drawingMaterial, setDrawingMaterial] = useState(false)
    const [inputStartPos, setInputStartPos] = useState<[number, number] | null>(null)
    const [inputDir, setInputDir] = useState<[number, number] | null>(null)

    const onInputDown = useCallback((clientPos: [number, number]) => {
        setInputStartPos(clientPos)

        if (activeBrush === BrushType.Signal) {
            mouseDownPos.current = clientPos
        } else if (activeBrush === BrushType.Material) {
            changeMaterial(clientPos)
            setDrawingMaterial(true)
        }

        setIsInputDown(true)
    }, [changeMaterial, activeBrush, mouseDownPos, setIsInputDown])

    const onInputMove = useCallback((clientPos: [number, number], shiftDown?: boolean) => {
        let pos: [number, number] = clientPos

        // If snapping, change the position to lie along the draw line
        if ((snapInput || shiftDown) && inputStartPos) {
            const offset = [pos[0] - inputStartPos[0], pos[1] - inputStartPos[1]]
            if (inputDir) {
                const projection = offset[0] * inputDir[0] + offset[1] * inputDir[1]
                pos = [inputStartPos[0] + projection * inputDir[0], inputStartPos[1] + projection * inputDir[1]]
            } else {
                const offsetLengthSq = offset[0] * offset[0] + offset[1] * offset[1]
                const minimumSnapLengthSq = 0.01 * 0.01 * (windowSize[0] * windowSize[0] + windowSize[1] * windowSize[1])
                if (offsetLengthSq > minimumSnapLengthSq) {
                    // Snap to discrete angles
                    const angleQuantum = Math.PI / 4
                    const snappedAngle = Math.round(Math.atan2(offset[1], offset[0]) / angleQuantum) * angleQuantum
                    const dir: [number, number] = [Math.cos(snappedAngle), Math.sin(snappedAngle)]
                    setInputDir(dir)
                }
            }
        }

        if (activeBrush === BrushType.Signal && mouseDownPos.current !== null) {
            mouseDownPos.current = pos
        }

        if (drawingMaterial) {
            changeMaterial(pos)
        }
    }, [changeMaterial, activeBrush, drawingMaterial, inputDir, inputStartPos, windowSize, snapInput, mouseDownPos])

    const onInputUp = useCallback(() => {
        if (activeBrush === BrushType.Signal) {
            mouseDownPos.current = null
        } else if (activeBrush === BrushType.Material) {
            setDrawingMaterial(false)
        }

        setInputDir(null)
        setInputStartPos(null)

        setIsInputDown(false)
    }, [activeBrush, mouseDownPos, setIsInputDown])

    return (
        <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef} style={{ position: "absolute", width: windowSize[0], height: windowSize[1], cursor: "none" }}
            onMouseDown={e => onInputDown([e.clientX, e.clientY])}
            onMouseMove={e => { setMousePosition([e.clientX, e.clientY]); onInputMove([e.clientX, e.clientY], e.shiftKey) }}
            onMouseUp={e => onInputUp()}
            onMouseLeave={e => onInputUp()}
            onTouchStart={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputDown([e.touches[0].clientX, e.touches[0].clientY]) }}
            onTouchMove={e => { setMousePosition([e.touches[0].clientX, e.touches[0].clientY]); onInputMove([e.touches[0].clientX, e.touches[0].clientY]) }}
            onTouchEnd={e => { setMousePosition(null); onInputUp() }}
            onTouchCancel={e => { setMousePosition(null); onInputUp() }}
            onContextMenu={e => e.preventDefault()}
        />
    )
}

type FullscreenViewProps = {
    children?: ReactElement<any> | ReactElement<any>[]
}

export function FullscreenView(props: FullscreenViewProps) {
    return (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, touchAction: "none", userSelect: "none" }}>
            {props.children}
        </div>
    )
}