import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { EMState, createEM } from "./em"
import { makeDrawSquareInfo, makeDrawCircleInfo, DrawShapeType } from "./em/drawing"
import { MaterialMap, signalSourceToDescriptor, descriptorToSignalSource } from './em/serialization'
import { CollapsibleContainer, SettingsComponent, ExamplesComponent, ImageButton, ShareComponent, MaterialBrushMenu, SignalBrushMenu } from './components'
import { toggleFullScreen, clamp, qualityPresets } from './util'
import * as Icon from "./icons"
import { getSharedSimulatorMap, shareSimulatorMap } from './share'
import { BounceLoader } from "react-spinners"

enum SideBarType {
    SignalBrush = "Signal Brush",
    MaterialBrush = "Material Brush",
    Settings = "Settings",
    Examples = "Examples"
}

const defaultPreset = qualityPresets["Medium"]

const defaultSignalBrushValue = 10
const defaultSignalBrushSize = 1
const defaultSignalFrequency = 3
const defaultPermittivityBrushValue = 5
const defaultPermeabilityBrushValue = 1
const defaultConductivityBrushValue = 0
const defaultMaterialBrushSize = 5
const defaultDrawShapeType = "square"

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
    const [drawShapeType, setDrawShapeType] = useState<DrawShapeType>(defaultDrawShapeType)

    const [materialBrushSize, setMaterialBrushSize] = useState(defaultMaterialBrushSize)
    const [permittivityBrushValue, setPermittivityBrushValue] = useState(defaultPermittivityBrushValue)
    const [permeabilityBrushValue, setPermeabilityBrushValue] = useState(defaultPermeabilityBrushValue)
    const [conductivityBrushValue, setConductivityBrushValue] = useState(defaultConductivityBrushValue)
    const [signalFrequency, setSignalFrequency] = useState(defaultSignalFrequency)
    const [drawingMaterial, setDrawingMaterial] = useState(false)
    const optionMaterialBrush = 0
    const optionSignal = 1
    const [clickOption, setClickOption] = useState(optionSignal) // material, signal

    const [mousePosition, setMousePosition] = useState<[number, number] | null>(null)

    const signalStrength = useRef(0)
    const mouseDownPos = useRef<[number, number] | null>(null)

    const [shareInProgress, setShareInProgress] = useState(false)
    const [sideMenuCollapsed, setSideMenuCollapsed] = useState(false)
    const [infoVisible, setInfoVisible] = useState(false)
    const [showLoading, setShowLoading] = useState(false)

    // Snap input across a line
    const [snapInput, setSnapInput] = useState(false)
    const [inputStartPos, setInputStartPos] = useState<[number, number] | null>(null)
    const [inputDir, setInputDir] = useState<[number, number] | null>(null)

    const windowToSimulationPoint = useMemo(() => {
        return (windowPoint: [number, number]) => {
            const simulationPoint: [number, number] = [
                clamp(0, 1, windowPoint[0] / windowSize[0]),
                clamp(0, 1, 1 - windowPoint[1] / windowSize[1])
            ]
            return simulationPoint
        }
    }, [windowSize])

    const simStep = useCallback(() => {
        if (em) {
            if (mouseDownPos.current !== null) {
                const center: [number, number] = windowToSimulationPoint(mouseDownPos.current)
                const brushHalfSize = signalBrushSize / gridSize[1] / 2
                const value = -signalBrushValue * 2000 * Math.cos(2 * Math.PI * signalFrequency * em.getTime())

                const drawInfo = drawShapeType === "square" ?
                    makeDrawSquareInfo(center, brushHalfSize, value) :
                    makeDrawCircleInfo(center, brushHalfSize, value)

                em.injectSignal(drawInfo, dt)
            }

            em.stepSim(dt)
        }
    }, [em, dt, signalFrequency, signalBrushValue, signalBrushSize, windowToSimulationPoint, drawShapeType, gridSize])

    useEffect(() => {
        if (simulationSpeed > 0) {
            const timer = setInterval(simStep, 1000 / simulationSpeed * dt)
            return () => clearInterval(timer)
        }

        return undefined
    }, [simStep, dt, simulationSpeed])

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

    const changeMaterial = useCallback((canvasPos: [number, number]) => {
        if (em) {
            const center: [number, number] = windowToSimulationPoint(canvasPos)
            const brushHalfSize = materialBrushSize / gridSize[1] / 2

            em.drawMaterial("permittivity", drawShapeType === "square" ?
                makeDrawSquareInfo(center, brushHalfSize, permittivityBrushValue) :
                makeDrawCircleInfo(center, brushHalfSize, permittivityBrushValue))

            em.drawMaterial("permeability", drawShapeType === "square" ?
                makeDrawSquareInfo(center, brushHalfSize, permeabilityBrushValue) :
                makeDrawCircleInfo(center, brushHalfSize, permeabilityBrushValue))

            em.drawMaterial("conductivity", drawShapeType === "square" ?
                makeDrawSquareInfo(center, brushHalfSize, conductivityBrushValue) :
                makeDrawCircleInfo(center, brushHalfSize, conductivityBrushValue))
        }
    }, [em, gridSize, materialBrushSize, permittivityBrushValue, permeabilityBrushValue, conductivityBrushValue, drawShapeType, windowToSimulationPoint])

    const resetMaterials = useCallback(() => {
        if (em) {
            em.setSources([])
            em.resetMaterials()
        }
    }, [em])

    const resetFields = useCallback(() => {
        if (em) {
            em.resetFields()
            signalStrength.current = 0
        }
    }, [em])

    const [isInputDown, setIsInputDown] = useState(false)

    const onInputDown = useCallback((clientPos: [number, number]) => {
        setInputStartPos(clientPos)

        if (clickOption === optionSignal) {
            mouseDownPos.current = clientPos
        } else if (clickOption === optionMaterialBrush) {
            changeMaterial(clientPos)
            setDrawingMaterial(true)
        }

        setIsInputDown(true)
    }, [changeMaterial, clickOption])

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

        if (clickOption === optionSignal && mouseDownPos.current !== null) {
            mouseDownPos.current = pos
        }

        if (drawingMaterial) {
            changeMaterial(pos)
        }
    }, [changeMaterial, clickOption, drawingMaterial, inputDir, inputStartPos, windowSize, snapInput])

    const onInputUp = useCallback(() => {
        if (clickOption === optionSignal) {
            mouseDownPos.current = null
        } else if (clickOption === optionMaterialBrush) {
            setDrawingMaterial(false)
        }

        setInputDir(null)
        setInputStartPos(null)

        setIsInputDown(false)
    }, [clickOption])

    const activeBrushSize = useMemo(() => (clickOption === optionSignal ? signalBrushSize : materialBrushSize) * (canvasSize[0] / gridSize[0]), [clickOption, signalBrushSize, materialBrushSize, canvasSize, gridSize])

    const [sideBar, setSideBar] = useState(SideBarType.SignalBrush)
    const [shareVisible, setShareVisible] = useState(false)

    const hideWhenInputDownStyle = useMemo<React.CSSProperties>(() => isInputDown ? { pointerEvents: "none", opacity: 0.2 } : {}, [isInputDown])

    const getMaterialMap = useMemo<() => (MaterialMap | null)>(() => {
        return () => {
            // TODO
            /*if (simulator) {
                const simData = simulator.getData()
                return {
                    permittivity: simData.permittivity.values.toArray() as number[][],
                    permeability: simData.permeability.values.toArray() as number[][],
                    conductivity: simData.conductivity.values.toArray() as number[][],
                    shape: [simData.permeability.shape[0], simData.permeability.shape[1]]
                }
            }*/

            return null
        }
    }, [em])

    const generateShareUrl = useCallback(() => {
        if (em) {
            setShareInProgress(true)
            const materialMap = getMaterialMap()
            if (materialMap) {
                shareSimulatorMap({
                    materialMap: materialMap,
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
    }, [getMaterialMap, dt, cellSize, gridSize, em])

    const shareUrl = useMemo(() => {
        return shareId ? `${window.location.origin}${window.location.pathname}#${shareId}` : null
    }, [shareId])

    // Open side menu when switching the side bar
    useEffect(() => {
        setSideMenuCollapsed(false)
    }, [sideBar])

    return (
        <div>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, touchAction: "none", userSelect: "none" }}>
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

                <div style={{ position: "absolute", bottom: 10, right: 10, ...hideWhenInputDownStyle }}>
                    <ImageButton onClick={_ => { generateShareUrl(); setShareVisible(!shareVisible) }} src={Icon.Share} highlight={shareVisible} />
                    <ImageButton onClick={_ => setInfoVisible(!infoVisible)} src={Icon.Info} />
                    <a href="https://github.com/RobinKa/maxwell-simulation"><ImageButton src={Icon.GitHub} /></a>
                </div>

                {mousePosition && (drawShapeType === "square" ?
                    <div style={{ position: "absolute", pointerEvents: "none", left: mousePosition[0] - activeBrushSize / 2, top: mousePosition[1] - activeBrushSize / 2, width: activeBrushSize, height: activeBrushSize, border: "2px solid rgb(255, 89, 0)" }} /> :
                    <div style={{ position: "absolute", pointerEvents: "none", left: mousePosition[0] - activeBrushSize / 2, top: mousePosition[1] - activeBrushSize / 2, width: activeBrushSize, height: activeBrushSize, border: "2px solid rgb(255, 89, 0)", borderRadius: "50%" }} />)
                }

                <div style={{ position: "absolute", top: "10px", left: "10px", ...hideWhenInputDownStyle }}>
                    <ImageButton onClick={_ => { setSideBar(SideBarType.SignalBrush); setClickOption(optionSignal) }} src={Icon.SignalBrush} highlight={sideBar === SideBarType.SignalBrush} />
                    <ImageButton onClick={_ => { setSideBar(SideBarType.MaterialBrush); setClickOption(optionMaterialBrush) }} src={Icon.MaterialBrush} highlight={sideBar === SideBarType.MaterialBrush} />
                </div>

                <div style={{ position: "absolute", top: "10px", right: "10px", ...hideWhenInputDownStyle }}>
                    <ImageButton onClick={_ => setSideBar(SideBarType.Examples)} src={Icon.Examples} highlight={sideBar === SideBarType.Examples} />
                    <ImageButton onClick={_ => setSideBar(SideBarType.Settings)} src={Icon.Settings} highlight={sideBar === SideBarType.Settings} />
                    <ImageButton onClick={toggleFullScreen} src={Icon.Fullscreen} />
                </div>

                <div style={{ position: "absolute", bottom: "10px", left: "10px", ...hideWhenInputDownStyle }}>
                    <ImageButton onClick={resetFields} src={Icon.ResetFields} />
                    <ImageButton onClick={resetMaterials} src={Icon.ResetMaterials} />
                </div>

                <CollapsibleContainer collapsed={sideMenuCollapsed} setCollapsed={setSideMenuCollapsed} title={sideBar.toString()}
                    style={{ position: "absolute", top: "50%", height: "400px", marginTop: "-200px", right: 0, opacity: 0.9, ...hideWhenInputDownStyle }}>
                    {sideBar === SideBarType.SignalBrush ?
                        <SignalBrushMenu
                            signalBrushSize={signalBrushSize} setSignalBrushSize={setSignalBrushSize}
                            signalBrushValue={signalBrushValue} setSignalBrushValue={setSignalBrushValue}
                            signalFrequency={signalFrequency} setSignalFrequency={setSignalFrequency}
                            drawShapeType={drawShapeType} setDrawShapeType={setDrawShapeType}
                            snapInput={snapInput} setSnapInput={setSnapInput} /> : (sideBar === SideBarType.MaterialBrush ?
                                <MaterialBrushMenu
                                    materialBrushSize={materialBrushSize} setMaterialBrushSize={setMaterialBrushSize}
                                    permittivityBrushValue={permittivityBrushValue} setPermittivityBrushValue={setPermittivityBrushValue}
                                    permeabilityBrushValue={permeabilityBrushValue} setPermeabilityBrushValue={setPermeabilityBrushValue}
                                    conductivityBrushValue={conductivityBrushValue} setConductivityBrushValue={setConductivityBrushValue}
                                    drawShapeType={drawShapeType} setDrawShapeType={setDrawShapeType}
                                    snapInput={snapInput} setSnapInput={setSnapInput} /> : (sideBar === SideBarType.Settings ?
                                        <SettingsComponent
                                            gridSizeLongest={gridSizeLongest} setGridSizeLongest={setGridSizeLongest}
                                            simulationSpeed={simulationSpeed} setSimulationSpeed={setSimulationSpeed}
                                            resolutionScale={resolutionScale} setResolutionScale={setResolutionScale}
                                            cellSize={cellSize} setCellSize={setCellSize}
                                            reflectiveBoundary={reflectiveBoundary} setReflectiveBoundary={setReflectiveBoundary}
                                            dt={dt} setDt={setDt}
                                            qualityPresets={qualityPresets} /> : (sideBar === SideBarType.Examples ?
                                                <ExamplesComponent
                                                    em={em} setCellSize={setCellSize} setDt={setDt}
                                                    setGridSizeLongest={setGridSizeLongest} setSimulationSpeed={setSimulationSpeed}
                                                    gridSize={gridSize} dt={dt}
                                                    cellSize={cellSize} simulationSpeed={simulationSpeed} /> : <div />)))}
                </CollapsibleContainer>
            </div>

            {shareVisible &&
                <div>
                    <div onClick={_ => setShareVisible(false)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
                    {!(shareInProgress || !shareUrl) &&
                        <div style={{ position: "absolute", backgroundColor: "rgb(30, 30, 30)", left: "50%", top: "50%", marginLeft: "-150px", marginTop: "-30px", width: "300px", height: "60px", textAlign: "center", padding: "10px" }}>
                            <ShareComponent shareUrl={shareUrl} shareText="Check out what I made in this interactive web-based simulator for electromagnetic waves!" shareTitle="EM Simulator" />
                        </div>
                    }
                </div>
            }

            {((shareVisible && (shareInProgress || !shareUrl)) || showLoading) &&
                <div>
                    <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
                    <div style={{ position: "absolute", left: "50%", top: "50%", marginLeft: "-75px", marginTop: "-75px", width: "150px", height: "150px", textAlign: "center" }}>
                        <BounceLoader color="rgb(0, 150, 255)" size={100} />
                    </div>
                </div>
            }

            {infoVisible &&
                <div>
                    <div onClick={_ => setInfoVisible(false)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0, 0, 0, 0.5)" }} />
                    <div style={{ position: "absolute", backgroundColor: "rgb(30, 30, 30)", left: "50%", top: "50%", marginLeft: "-150px", marginTop: "-70px", width: "300px", height: "140px", textAlign: "center", padding: "10px", color: "white", fontWeight: "lighter" }}>
                        <div>
                            Made by <a href="https://github.com/RobinKa" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">Robin Kahlow</a>. If you have feedback, ideas for improvement, bug reports or anything else open an issue on <a href="https://github.com/RobinKa/maxwell-simulation/issues" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">GitHub</a> or <a href="mailto:tora@warlock.ai?subject=EM simulation feedback" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }}>send an email to tora@warlock.ai</a>.
                        </div>
                        <div style={{ marginTop: "5px" }}><a href="https://github.com/RobinKa/maxwell-simulation" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">Source code</a></div>
                        <div style={{ marginTop: "5px" }}>Icons by <a href="https://icons8.com/" style={{ textDecoration: "none", color: "rgb(0, 150, 255)" }} rel="noopener noreferrer" target="_blank">Icons8</a></div>
                    </div>
                </div>
            }
        </div>
    )
}