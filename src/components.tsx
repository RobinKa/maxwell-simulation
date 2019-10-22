import React, { ReactElement, useState, useCallback } from "react"
import { simulatorMapToImageUrl, imageUrlToSimulatorMap } from "./util"
import { FDTDSimulator } from "./simulator"

export type CollapsibleContainerProps = {
    children: ReactElement<any> | ReactElement<any>[] | null
    style?: React.CSSProperties
    title?: string
}

export function CollapsibleContainer(props: CollapsibleContainerProps) {
    const [collapsed, setCollapsed] = useState(false)

    return (
        <div style={{ textAlign: "center", background: "rgba(33, 33, 33, 100)", fontWeight: "lighter", color: "white", ...props.style }}>
            <button onClick={e => setCollapsed(!collapsed)} style={{ width: "100%", height: "24px", background: "rgba(50, 50, 50, 100)", border: "0px", color: "white", fontWeight: "bold", cursor: "pointer" }}>
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
}

export function LabeledSlider(props: LabeledSliderProps) {
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

export type OptionSelectorProps = {
    options: string[]
    selectedOption: number
    setSelectedOption: (selectedOption: number) => void
}

export function OptionSelector(props: OptionSelectorProps) {
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

export type ControlComponentProps = {
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

export function ControlComponent(props: ControlComponentProps) {
    return (
        <div style={{ padding: "10px" }}>
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
    )
}