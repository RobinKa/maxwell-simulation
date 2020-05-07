import React, { useRef, useCallback, useEffect, useState, useMemo, useReducer } from 'react'
import { makeDrawSquareInfo, makeDrawEllipseInfo, DrawShape } from "./em/drawing"
import { signalSourceToDescriptor, descriptorToSignalSource, makeMaterialMap } from './em/serialization'
import {
    SideBarType, BrushType, CollapsibleContainer, SettingsComponent, ExamplesComponent,
    MaterialBrushMenu, SignalBrushMenu, MultiMenu, MultiMenuChild, InfoBox, LoadingIndicator,
    ShareBox, ResetButtons, BrushSelectionButtons, MenuSelectionButtons, BrushCursor, MiscButtons,
    InteractiveCanvas, FullscreenView
} from './components'
import { clamp, qualityPresets } from './util'
import { getSharedSimulatorMap, shareSimulatorMap } from './share'
import { appReducer, makeAppState } from './AppState'

const defaultSignalBrushValue = 10
const defaultSignalBrushSize = 1
const defaultSignalFrequency = 3
const defaultPermittivityBrushValue = 5
const defaultPermeabilityBrushValue = 1
const defaultConductivityBrushValue = 0
const defaultMaterialBrushSize = 5
const defaultBrushDrawShape = DrawShape.Square

export default function () {
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)
    const [state, dispatch] = useReducer(appReducer, makeAppState())

    // Set canvas
    useEffect(() => {
        dispatch({
            type: "setDrawCanvas",
            drawCanvas: drawCanvasRef.current
        })
    }, [drawCanvasRef])

    // Window resize canvas
    useEffect(() => {
        const adjustCanvasSize = () => {
            dispatch({
                type: "setParameters",
                windowSize: [window.innerWidth, window.innerHeight]
            })
        }

        adjustCanvasSize()

        window.addEventListener("resize", adjustCanvasSize)
        return () => window.removeEventListener("resize", adjustCanvasSize)
    }, [])

    // Load share id if one was given
    useEffect(() => {
        const em = state.em
        const urlShareId = state.urlShareId
        if (em && urlShareId) {
            setShowLoading(true)
            console.log(`Loading ${urlShareId}`)
            getSharedSimulatorMap(urlShareId).then(simulatorMap => {
                // Load material
                em.loadMaterialFromComponents(
                    simulatorMap.materialMap.permittivity,
                    simulatorMap.materialMap.permeability,
                    simulatorMap.materialMap.conductivity
                )

                // Load settings
                dispatch({
                    type: "setParameters",
                    dt: simulatorMap.simulationSettings.dt
                })

                dispatch({
                    type: "setSimulationParameters",
                    cellSize: simulatorMap.simulationSettings.cellSize,
                    gridSizeLongest: Math.max(simulatorMap.simulationSettings.gridSize[0], simulatorMap.simulationSettings.gridSize[1])
                })

                // Load sources
                em.setSources(simulatorMap.sourceDescriptors.map(desc => descriptorToSignalSource(desc)))

                console.log(`Loaded ${urlShareId}`)
            }).catch(err => console.error(`Error getting share ${urlShareId}: ${JSON.stringify(err)}`)).finally(() => setShowLoading(false))
        }
    }, [state.em, state.urlShareId])

    const [signalBrushSize, setSignalBrushSize] = useState(defaultSignalBrushSize)
    const [signalBrushValue, setSignalBrushValue] = useState(defaultSignalBrushValue)
    const [activeBrushShape, setActiveBrushDrawShape] = useState<DrawShape>(defaultBrushDrawShape)

    const [materialBrushSize, setMaterialBrushSize] = useState(defaultMaterialBrushSize)
    const [permittivityBrushValue, setPermittivityBrushValue] = useState(defaultPermittivityBrushValue)
    const [permeabilityBrushValue, setPermeabilityBrushValue] = useState(defaultPermeabilityBrushValue)
    const [conductivityBrushValue, setConductivityBrushValue] = useState(defaultConductivityBrushValue)
    const [signalFrequency, setSignalFrequency] = useState(defaultSignalFrequency)

    const [activeBrush, setActiveBrush] = useState(BrushType.Signal)

    const [mousePosition, setMousePosition] = useState<[number, number] | null>(null)

    const signalStrength = useRef(0)
    const mouseDownPos = useRef<[number, number] | null>(null)

    const [shareInProgress, setShareInProgress] = useState(false)
    const [sideMenuCollapsed, setSideMenuCollapsed] = useState(false)
    const [infoVisible, setInfoVisible] = useState(false)
    const [showLoading, setShowLoading] = useState(false)

    // Snap input across a line
    const [snapInput, setSnapInput] = useState(false)

    // Convert from window location to the coordinates used
    // by the simulator's draw function.
    const windowToSimulationPoint = useMemo(() => {
        return (windowPoint: [number, number]) => {
            const simulationPoint: [number, number] = [
                clamp(0, 1, windowPoint[0] / state.windowSize[0]),
                clamp(0, 1, 1 - windowPoint[1] / state.windowSize[1])
            ]

            return simulationPoint
        }
    }, [state.windowSize])

    // Simulate one step
    const simStep = useCallback(() => {
        if (state.em) {
            if (mouseDownPos.current !== null) {
                const gridSize = state.gridSize
                const center: [number, number] = windowToSimulationPoint(mouseDownPos.current)
                const brushHalfSize: [number, number] = [
                    signalBrushSize / gridSize[0] / 2,
                    signalBrushSize / gridSize[1] / 2
                ]

                const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * state.em.getTime())

                const drawInfo = activeBrushShape === DrawShape.Square ?
                    makeDrawSquareInfo(center, brushHalfSize, value) :
                    makeDrawEllipseInfo(center, brushHalfSize, value)

                state.em.injectSignal(drawInfo, state.dt)
            }

            state.em.stepSim(state.dt)
        }
    }, [state.em, state.dt, state.gridSize, signalFrequency, signalBrushValue, signalBrushSize, windowToSimulationPoint, activeBrushShape])

    // Change simulation speed
    useEffect(() => {
        if (state.simulationSpeed > 0) {
            const timer = setInterval(simStep, 1000 / state.simulationSpeed * state.dt)
            return () => clearInterval(timer)
        }

        return undefined
    }, [simStep, state.dt, state.simulationSpeed])

    // Draw one frame
    const drawStep = useCallback(() => {
        state.em?.renderToCanvas(true, true)
    }, [state.em])

    // Draw loop
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

    // Reset materials in the simulator
    const resetMaterials = useCallback(() => {
        if (state.em) {
            state.em.setSources([])
            state.em.resetMaterials()
        }
    }, [state.em])

    // Reset fields in the simulator
    const resetFields = useCallback(() => {
        if (state.em) {
            state.em.resetFields()
            signalStrength.current = 0
        }
    }, [state.em])

    const [isInputDown, setIsInputDown] = useState(false)

    const activeBrushSize = useMemo(() =>
        (activeBrush === BrushType.Signal ? signalBrushSize : materialBrushSize) * (state.canvasSize[0] / state.gridSize[0]),
        [activeBrush, signalBrushSize, materialBrushSize, state.canvasSize, state.gridSize]
    )

    const [sideBar, setSideBar] = useState(SideBarType.SignalBrush)
    const [shareVisible, setShareVisible] = useState(false)

    const hideWhenInputDownStyle = useMemo<React.CSSProperties>(() => isInputDown ? { pointerEvents: "none", opacity: 0.2 } : {}, [isInputDown])

    const generateShareUrl = useCallback(() => {
        if (state.em) {
            setShareInProgress(true)
            const material = state.em.getMaterial()
            if (material) {
                shareSimulatorMap({
                    materialMap: makeMaterialMap(material),
                    simulationSettings: {
                        cellSize: state.cellSize,
                        dt: state.dt,
                        gridSize: state.gridSize,
                        simulationSpeed: 1
                    },
                    sourceDescriptors: state.em.getSources().map(source => signalSourceToDescriptor(source))
                })
                    .then(shareId => dispatch({ type: "setParameters", shareId: shareId }))
                    .catch(err => console.log("Error uploading share: " + JSON.stringify(err)))
                    .finally(() => setShareInProgress(false))
            }
        }
    }, [state.dt, state.cellSize, state.gridSize, state.em])

    const shareUrl = useMemo(() => {
        return state.shareId ? `${window.location.origin}${window.location.pathname}#${state.shareId}` : null
    }, [state.shareId])

    // Open side menu when switching the side bar
    useEffect(() => {
        setSideMenuCollapsed(false)
    }, [sideBar])

    const setGridSizeLongest = useCallback((newGridSizeLongest: number) => {
        dispatch({ type: "setSimulationParameters", gridSizeLongest: newGridSizeLongest })
    }, [dispatch])

    const setCellSize = useCallback((newCellSize: number) => {
        dispatch({ type: "setSimulationParameters", cellSize: newCellSize })
    }, [dispatch])

    const setReflectiveBoundary = useCallback((newReflectiveBoundary: boolean) => {
        dispatch({ type: "setSimulationParameters", reflectiveBoundary: newReflectiveBoundary })
    }, [dispatch])

    const setDt = useCallback((newDt: number) => {
        dispatch({ type: "setParameters", dt: newDt })
    }, [dispatch])

    const setSimulationSpeed = useCallback((newSimulationSpeed: number) => {
        dispatch({ type: "setParameters", simulationSpeed: newSimulationSpeed })
    }, [dispatch])

    const setResolutionScale = useCallback((newResolutionScale: number) => {
        dispatch({ type: "setParameters", resolutionScale: newResolutionScale })
    }, [dispatch])

    return <>
        <FullscreenView>
            <InteractiveCanvas activeBrush={activeBrush} activeBrushShape={activeBrushShape} canvasSize={state.canvasSize}
                conductivityBrushValue={conductivityBrushValue} drawCanvasRef={drawCanvasRef} em={state.em}
                gridSize={state.gridSize} materialBrushSize={materialBrushSize} mouseDownPos={mouseDownPos}
                permeabilityBrushValue={permeabilityBrushValue} permittivityBrushValue={permittivityBrushValue}
                setIsInputDown={setIsInputDown} setMousePosition={setMousePosition} snapInput={snapInput}
                windowSize={state.windowSize} windowToSimulationPoint={windowToSimulationPoint} />

            <BrushCursor mousePosition={mousePosition} activeBrushSize={activeBrushSize} brushShape={activeBrushShape} />

            <MiscButtons extraStyle={hideWhenInputDownStyle} generateShareUrl={generateShareUrl}
                infoVisible={infoVisible} setInfoVisible={setInfoVisible}
                shareVisible={shareVisible} setShareVisible={setShareVisible} />
            <BrushSelectionButtons activeSideBar={sideBar} setActiveSideBar={setSideBar} setActiveBrush={setActiveBrush} extraStyle={hideWhenInputDownStyle} />
            <MenuSelectionButtons activeSideBar={sideBar} setActiveSideBar={setSideBar} extraStyle={hideWhenInputDownStyle} />
            <ResetButtons resetFields={resetFields} resetMaterials={resetMaterials} extraStyle={hideWhenInputDownStyle} />

            <CollapsibleContainer collapsed={sideMenuCollapsed} setCollapsed={setSideMenuCollapsed} title={sideBar.toString()}
                style={{ position: "absolute", top: "50%", height: "400px", marginTop: "-200px", right: 0, opacity: 0.9, ...hideWhenInputDownStyle }}>
                <MultiMenu activeState={sideBar}>
                    <MultiMenuChild activateForState={SideBarType.SignalBrush}>
                        <SignalBrushMenu
                            signalBrushSize={signalBrushSize} setSignalBrushSize={setSignalBrushSize}
                            signalBrushValue={signalBrushValue} setSignalBrushValue={setSignalBrushValue}
                            signalFrequency={signalFrequency} setSignalFrequency={setSignalFrequency}
                            activeBrushShape={activeBrushShape} setActiveBrushDrawShape={setActiveBrushDrawShape}
                            snapInput={snapInput} setSnapInput={setSnapInput} />
                    </MultiMenuChild>

                    <MultiMenuChild activateForState={SideBarType.MaterialBrush}>
                        <MaterialBrushMenu
                            materialBrushSize={materialBrushSize} setMaterialBrushSize={setMaterialBrushSize}
                            permittivityBrushValue={permittivityBrushValue} setPermittivityBrushValue={setPermittivityBrushValue}
                            permeabilityBrushValue={permeabilityBrushValue} setPermeabilityBrushValue={setPermeabilityBrushValue}
                            conductivityBrushValue={conductivityBrushValue} setConductivityBrushValue={setConductivityBrushValue}
                            activeBrushShape={activeBrushShape} setActiveBrushDrawShape={setActiveBrushDrawShape}
                            snapInput={snapInput} setSnapInput={setSnapInput} />
                    </MultiMenuChild>

                    <MultiMenuChild activateForState={SideBarType.Settings}>
                        <SettingsComponent
                            gridSizeLongest={state.gridSizeLongest} setGridSizeLongest={setGridSizeLongest}
                            simulationSpeed={state.simulationSpeed} setSimulationSpeed={setSimulationSpeed}
                            resolutionScale={state.resolutionScale} setResolutionScale={setResolutionScale}
                            cellSize={state.cellSize} setCellSize={setCellSize}
                            reflectiveBoundary={state.reflectiveBoundary} setReflectiveBoundary={setReflectiveBoundary}
                            dt={state.dt} setDt={setDt}
                            qualityPresets={qualityPresets} />
                    </MultiMenuChild>

                    <MultiMenuChild activateForState={SideBarType.Examples}>
                        <ExamplesComponent
                            em={state.em} setCellSize={setCellSize} setDt={setDt}
                            setGridSizeLongest={setGridSizeLongest} setSimulationSpeed={setSimulationSpeed}
                            gridSize={state.gridSize} dt={state.dt}
                            cellSize={state.cellSize} simulationSpeed={state.simulationSpeed} />
                    </MultiMenuChild>
                </MultiMenu>
            </CollapsibleContainer>
        </FullscreenView>

        <ShareBox visible={shareVisible} setVisible={setShareVisible} shareUrl={shareUrl} shareInProgress={shareInProgress} />
        <LoadingIndicator visible={(shareVisible && (shareInProgress || !shareUrl)) || showLoading} />
        <InfoBox visible={infoVisible} setVisible={setInfoVisible} />
    </>
}