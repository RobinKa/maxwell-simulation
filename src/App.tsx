import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { EMState, createEM } from "./em"
import { makeDrawSquareInfo, makeDrawCircleInfo, DrawShape } from "./em/drawing"
import { signalSourceToDescriptor, descriptorToSignalSource, makeMaterialMap } from './em/serialization'
import {
    SideBarType, BrushType, CollapsibleContainer, SettingsComponent, ExamplesComponent,
    MaterialBrushMenu, SignalBrushMenu, MultiMenu, MultiMenuChild, InfoBox, LoadingIndicator,
    ShareBox, ResetButtons, BrushSelectionButtons, MenuSelectionButtons, BrushCursor, MiscButtons,
    InteractiveCanvas, FullscreenView
} from './components'
import { clamp, qualityPresets } from './util'
import { getSharedSimulatorMap, shareSimulatorMap } from './share'

const defaultPreset = qualityPresets["Medium"]

const defaultSignalBrushValue = 10
const defaultSignalBrushSize = 1
const defaultSignalFrequency = 3
const defaultPermittivityBrushValue = 5
const defaultPermeabilityBrushValue = 1
const defaultConductivityBrushValue = 0
const defaultMaterialBrushSize = 5
const defaultBrushDrawShape = "square"

const initialDt = defaultPreset.dt
const initialCellSize = defaultPreset.cellSize
const initialSimulationSpeed = 1
const initialGridSizeLongest = defaultPreset.gridSizeLongest
const initialResolutionScale = defaultPreset.resolutionScale
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

export default function () {
    const urlShareId = window.location.hash ? window.location.hash.substr(1) : null
    const [shareId, setShareId] = useState<string | null>(urlShareId)

    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const [canvasSize, setCanvasSize] = useState<[number, number]>(initialCanvasSize)
    const [windowSize, setWindowSize] = useState<[number, number]>(initialWindowSize)
    const [gridSizeLongest, setGridSizeLongest] = useState(initialGridSizeLongest)
    const [dt, setDt] = useState(initialDt)
    const [cellSize, setCellSize] = useState(initialCellSize)
    const [resolutionScale, setResolutionScale] = useState(initialResolutionScale)
    const [simulationSpeed, setSimulationSpeed] = useState(initialSimulationSpeed)
    const [reflectiveBoundary, setReflectiveBoundary] = useState(initialReflectiveBoundary)

    const gridSize = useMemo<[number, number]>(() => calculateGridSize(gridSizeLongest, canvasSize), [canvasSize, gridSizeLongest])
    const [em, setEm] = useState<EMState | null>(null)

    // Would use useMemo for gpu here, but useMemo does not seem to work with ref dependencies.
    useEffect(() => {
        if (drawCanvasRef.current) {
            setEm(createEM(drawCanvasRef.current, initialGridSize,
                initialCellSize, initialReflectiveBoundary, initialDt))
        }
    }, [drawCanvasRef])

    // Window resize canvas
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

    // Load share id
    useEffect(() => {
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
                setDt(simulatorMap.simulationSettings.dt)
                setGridSizeLongest(Math.max(simulatorMap.simulationSettings.gridSize[0], simulatorMap.simulationSettings.gridSize[1]))
                setCellSize(simulatorMap.simulationSettings.cellSize)

                // Load sources
                em.setSources(simulatorMap.sourceDescriptors.map(desc => descriptorToSignalSource(desc)))

                console.log(`Loaded ${urlShareId}`)
            }).catch(err => console.error(`Error getting share ${urlShareId}: ${JSON.stringify(err)}`)).finally(() => setShowLoading(false))
        }
    }, [em, urlShareId])

    // Update render sim output size
    useEffect(() => {
        if (em) {
            em.adjustCanvasSize(canvasSize)
            em.resetFields()
            em.resetMaterials()
        }
    }, [em, canvasSize])

    // Update simulator grid size
    useEffect(() => {
        if (em) {
            em.setGridSize(gridSize)
            em.resetFields()
            em.resetMaterials()
        }
    }, [em, gridSize])

    // Update simulator cell size
    useEffect(() => {
        if (em) {
            em.setCellSize(cellSize)
        }
    }, [em, cellSize])

    // Update reflective boundary
    useEffect(() => {
        if (em) {
            em.setReflectiveBoundary(reflectiveBoundary)
        }
    }, [em, reflectiveBoundary])

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
                clamp(0, 1, windowPoint[0] / windowSize[0]),
                clamp(0, 1, 1 - windowPoint[1] / windowSize[1])
            ]
            return simulationPoint
        }
    }, [windowSize])

    // Simulate one step
    const simStep = useCallback(() => {
        if (em) {
            if (mouseDownPos.current !== null) {
                const center: [number, number] = windowToSimulationPoint(mouseDownPos.current)
                const brushHalfSize = signalBrushSize / gridSize[1] / 2
                const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * em.getTime())

                const drawInfo = activeBrushShape === "square" ?
                    makeDrawSquareInfo(center, brushHalfSize, value) :
                    makeDrawCircleInfo(center, brushHalfSize, value)

                em.injectSignal(drawInfo, dt)
            }

            em.stepSim(dt)
        }
    }, [em, dt, signalFrequency, signalBrushValue, signalBrushSize, windowToSimulationPoint, activeBrushShape, gridSize])

    // Change simulation speed
    useEffect(() => {
        if (simulationSpeed > 0) {
            const timer = setInterval(simStep, 1000 / simulationSpeed * dt)
            return () => clearInterval(timer)
        }

        return undefined
    }, [simStep, dt, simulationSpeed])

    // Draw one frame
    const drawStep = useCallback(() => {
        if (em) {
            if (drawCanvasRef.current) {
                const cnvSize = calculateCanvasSize([window.innerWidth, window.innerHeight], resolutionScale)
                drawCanvasRef.current.width = cnvSize[0]
                drawCanvasRef.current.height = cnvSize[1]
            }

            em?.renderToCanvas(true, true)
        }
    }, [em, resolutionScale, drawCanvasRef])

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
        if (em) {
            em.setSources([])
            em.resetMaterials()
        }
    }, [em])

    // Reset fields in the simulator
    const resetFields = useCallback(() => {
        if (em) {
            em.resetFields()
            signalStrength.current = 0
        }
    }, [em])

    const [isInputDown, setIsInputDown] = useState(false)

    const activeBrushSize = useMemo(() => (activeBrush === BrushType.Signal ? signalBrushSize : materialBrushSize) * (canvasSize[0] / gridSize[0]), [activeBrush, signalBrushSize, materialBrushSize, canvasSize, gridSize])

    const [sideBar, setSideBar] = useState(SideBarType.SignalBrush)
    const [shareVisible, setShareVisible] = useState(false)

    const hideWhenInputDownStyle = useMemo<React.CSSProperties>(() => isInputDown ? { pointerEvents: "none", opacity: 0.2 } : {}, [isInputDown])

    const generateShareUrl = useCallback(() => {
        if (em) {
            setShareInProgress(true)
            const material = em.getMaterial()
            if (material) {
                shareSimulatorMap({
                    materialMap: makeMaterialMap(material),
                    simulationSettings: {
                        cellSize: cellSize,
                        dt: dt,
                        gridSize: gridSize,
                        simulationSpeed: 1
                    },
                    sourceDescriptors: em.getSources().map(source => signalSourceToDescriptor(source))
                })
                    .then(shareId => setShareId(shareId))
                    .catch(err => console.log("Error uploading share: " + JSON.stringify(err)))
                    .finally(() => setShareInProgress(false))
            }
        }
    }, [dt, cellSize, gridSize, em])

    const shareUrl = useMemo(() => {
        return shareId ? `${window.location.origin}${window.location.pathname}#${shareId}` : null
    }, [shareId])

    // Open side menu when switching the side bar
    useEffect(() => {
        setSideMenuCollapsed(false)
    }, [sideBar])

    return <>
        <FullscreenView>
            <InteractiveCanvas activeBrush={activeBrush} activeBrushShape={activeBrushShape} canvasSize={canvasSize}
                conductivityBrushValue={conductivityBrushValue} drawCanvasRef={drawCanvasRef} em={em}
                gridSize={gridSize} materialBrushSize={materialBrushSize} mouseDownPos={mouseDownPos}
                permeabilityBrushValue={permeabilityBrushValue} permittivityBrushValue={permittivityBrushValue}
                setIsInputDown={setIsInputDown} setMousePosition={setMousePosition} snapInput={snapInput}
                windowSize={windowSize} windowToSimulationPoint={windowToSimulationPoint} />

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
                            gridSizeLongest={gridSizeLongest} setGridSizeLongest={setGridSizeLongest}
                            simulationSpeed={simulationSpeed} setSimulationSpeed={setSimulationSpeed}
                            resolutionScale={resolutionScale} setResolutionScale={setResolutionScale}
                            cellSize={cellSize} setCellSize={setCellSize}
                            reflectiveBoundary={reflectiveBoundary} setReflectiveBoundary={setReflectiveBoundary}
                            dt={dt} setDt={setDt}
                            qualityPresets={qualityPresets} />
                    </MultiMenuChild>

                    <MultiMenuChild activateForState={SideBarType.Examples}>
                        <ExamplesComponent
                            em={em} setCellSize={setCellSize} setDt={setDt}
                            setGridSizeLongest={setGridSizeLongest} setSimulationSpeed={setSimulationSpeed}
                            gridSize={gridSize} dt={dt}
                            cellSize={cellSize} simulationSpeed={simulationSpeed} />
                    </MultiMenuChild>
                </MultiMenu>
            </CollapsibleContainer>
        </FullscreenView>

        <ShareBox visible={shareVisible} setVisible={setShareVisible} shareUrl={shareUrl} shareInProgress={shareInProgress} />
        <LoadingIndicator visible={(shareVisible && (shareInProgress || !shareUrl)) || showLoading} />
        <InfoBox visible={infoVisible} setVisible={setInfoVisible} />
    </>
}