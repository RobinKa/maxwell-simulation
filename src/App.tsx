import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { GPU } from "gpu.js"

const gridSize = 19
const p = Math.floor(gridSize / 2)

const energyScale = 1

type Vector3D = [number, number, number]

type Field3D<T> = T[][][]
type ScalarField3D = Field3D<number>

function makeField3D<T>(shape: [number, number, number], getValue: (coords: [number, number, number]) => T): Field3D<T> {
    const field = []
    for (let x = 0; x < shape[0]; x++) {
        const row = []
        for (let y = 0; y < shape[1]; y++) {
            const d = []
            for (let z = 0; z < shape[2]; z++) {
                d.push(getValue([x, y, z]))
            }
            row.push(d)
        }
        field.push(row)
    }
    return field
}

const gpu = new GPU()

const fdCurlX3DA = gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const v = y + 1 >= this.constants.gridSize ? y : y + 1
    const w = z + 1 >= this.constants.gridSize ? z : z + 1

    return (fieldZ[x][v][z] - fieldZ[x][y][z]) - (fieldY[x][y][w] - fieldY[x][y][z])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })


const fdCurlY3DA = gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u = x + 1 >= this.constants.gridSize ? x : x + 1
    const w = z + 1 >= this.constants.gridSize ? z : z + 1

    return (fieldX[x][y][w] - fieldX[x][y][z]) - (fieldZ[u][y][z] - fieldZ[x][y][z])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })

const fdCurlZ3DA = gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u = x + 1 >= this.constants.gridSize ? x : x + 1
    const v = y + 1 >= this.constants.gridSize ? y : y + 1

    return (fieldY[u][y][z] - fieldY[x][y][z]) - (fieldX[x][v][z] - fieldX[x][y][z])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })


const fdCurlX3DB = gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const v: number = y - 1 < 0 ? y : y - 1
    const w: number = z - 1 < 0 ? z : z - 1

    return (fieldZ[x][y][z] - fieldZ[x][v][z]) - (fieldY[x][y][z] - fieldY[x][y][w])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })

const fdCurlY3DB = gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u: number = x - 1 < 0 ? x : x - 1
    const w: number = z - 1 < 0 ? z : z - 1

    return (fieldX[x][y][z] - fieldX[x][y][w]) - (fieldZ[x][y][z] - fieldZ[u][y][z])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })

const fdCurlZ3DB = gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u: number = x - 1 < 0 ? x : x - 1
    const v: number = y - 1 < 0 ? y : y - 1

    return (fieldY[x][y][z] - fieldY[u][y][z]) - (fieldX[x][y][z] - fieldX[x][v][z])
}, { output: [gridSize, gridSize, gridSize], constants: { gridSize: gridSize } })

function inplaceMulAddScalarField3D(a: ScalarField3D, b: ScalarField3D, s: number) {
    for (let x = 0; x < a.length; x++) {
        for (let y = 0; y < a[0].length; y++) {
            for (let z = 0; z < a[0][0].length; z++) {
                a[x][y][z] += s * b[x][y][z]
            }
        }
    }
}

type SimulationData = {
    time: number
    electricFieldX: ScalarField3D
    electricFieldY: ScalarField3D
    electricFieldZ: ScalarField3D
    magneticFieldX: ScalarField3D
    magneticFieldY: ScalarField3D
    magneticFieldZ: ScalarField3D
    permittivity: ScalarField3D
    permeability: ScalarField3D
}

interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    getData: () => SimulationData
}

class FDTDSimulator implements Simulator {
    private data: SimulationData

    constructor(shape: [number, number, number]) {
        this.data = {
            time: 0,
            electricFieldX: makeField3D<number>(shape, _ => 0),
            electricFieldY: makeField3D<number>(shape, _ => 0),
            electricFieldZ: makeField3D<number>(shape, _ => 0),
            magneticFieldX: makeField3D<number>(shape, _ => 0),
            magneticFieldY: makeField3D<number>(shape, _ => 0),
            magneticFieldZ: makeField3D<number>(shape, _ => 0),
            permittivity: makeField3D<number>(shape, (_) => 0),
            permeability: makeField3D<number>(shape, (_) => 0),
        }
    }

    stepElectric = (dt: number) => {
        // d/dt E(x, t) = (curl B(x, t))/(µε)
        const curlX = fdCurlX3DB(this.data.magneticFieldY, this.data.magneticFieldZ) as ScalarField3D
        const curlY = fdCurlY3DB(this.data.magneticFieldX, this.data.magneticFieldZ) as ScalarField3D
        const curlZ = fdCurlZ3DB(this.data.magneticFieldX, this.data.magneticFieldY) as ScalarField3D

        inplaceMulAddScalarField3D(this.data.electricFieldX, curlX, dt)
        inplaceMulAddScalarField3D(this.data.electricFieldY, curlY, dt)
        inplaceMulAddScalarField3D(this.data.electricFieldZ, curlZ, dt)

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        // d/dt B(x, t) = -curl E(x, t)
        const curlX = fdCurlX3DA(this.data.electricFieldY, this.data.electricFieldZ) as ScalarField3D
        const curlY = fdCurlY3DA(this.data.electricFieldX, this.data.electricFieldZ) as ScalarField3D
        const curlZ = fdCurlZ3DA(this.data.electricFieldX, this.data.electricFieldY) as ScalarField3D

        inplaceMulAddScalarField3D(this.data.magneticFieldX, curlX, -dt)
        inplaceMulAddScalarField3D(this.data.magneticFieldY, curlY, -dt)
        inplaceMulAddScalarField3D(this.data.magneticFieldZ, curlZ, -dt)

        this.data.time += dt / 2
    }

    getData = () => this.data
}

const simulator = new FDTDSimulator([gridSize, gridSize, gridSize])

function drawArrow(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], style: string) {
    const r = 5

    ctx.strokeStyle = style
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
    ctx.stroke()

    ctx.fillStyle = style
    ctx.beginPath()
    let angle = Math.atan2(to[1] - from[1], to[0] - from[0])
    let x = r * Math.cos(angle) + to[0]
    let y = r * Math.sin(angle) + to[1]
    ctx.moveTo(x, y)

    angle += (1 / 3) * (2 * Math.PI)
    x = r * Math.cos(angle) + to[0]
    y = r * Math.sin(angle) + to[1]
    ctx.lineTo(x, y)

    angle += (1 / 3) * (2 * Math.PI)
    x = r * Math.cos(angle) + to[0]
    y = r * Math.sin(angle) + to[1]
    ctx.lineTo(x, y)

    ctx.closePath()
    ctx.fill()
}

function crossVector3D(a: Vector3D, b: Vector3D): Vector3D {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

function magnitudeSquaredVector3D(v: Vector3D) {
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
}

function clampMagnitudeVector3D(maxMag: number, v: Vector3D): Vector3D {
    const magSq = magnitudeSquaredVector3D(v)

    if (magSq === 0 || magSq <= maxMag * maxMag) {
        return v
    }

    const mag = Math.sqrt(magSq)

    return [
        maxMag * v[0] / mag,
        maxMag * v[1] / mag,
        maxMag * v[2] / mag
    ]
}

export default function () {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    const [showElectric, setShowElectric] = useState(false)
    const [showMagnetic, setShowMagnetic] = useState(false)
    const [showPoynting, setShowPoynting] = useState(true)
    const [showEnergy, setShowEnergy] = useState(true)

    const redrawCanvas = useMemo(() => (simulationData: SimulationData) => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d")
            if (ctx) {
                ctx.fillStyle = "black"
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

                const cellSize = ctx.canvas.width / simulationData.electricFieldX.length
                const arrowLength = cellSize / 2.5

                let totalEnergy = 0
                let totalElectricEnergy = 0
                let totalMagneticEnergy = 0

                for (let x = 0; x < simulationData.electricFieldX.length; x++) {
                    for (let y = 0; y < simulationData.electricFieldX[0].length; y++) {
                        //for (let z = 0; z < 1; z++) {
                        const z = p; {
                            const canvasCoords: [number, number] = [
                                (x + 0.5) * cellSize + cellSize * z / (4 * simulationData.electricFieldX.length),
                                (y + 0.5) * cellSize - cellSize * z / (4 * simulationData.electricFieldX.length)
                            ]

                            const electricValue: [number, number, number] = [simulationData.electricFieldX[x][y][z], simulationData.electricFieldY[x][y][z], simulationData.electricFieldZ[x][y][z]]
                            const magneticValue: [number, number, number] = [simulationData.magneticFieldX[x][y][z], simulationData.magneticFieldY[x][y][z], simulationData.magneticFieldZ[x][y][z]]

                            const poyntingVector = crossVector3D(electricValue, magneticValue)

                            const electricEnergy = 0.5 * magnitudeSquaredVector3D(electricValue)
                            const magneticEnergy = 0.5 * magnitudeSquaredVector3D(magneticValue)
                            const energy = electricEnergy + magneticEnergy // + magnitudeVector3D(poyntingVector)

                            totalEnergy += energy
                            totalElectricEnergy += electricEnergy
                            totalMagneticEnergy += magneticEnergy

                            const depthColor = 255 * z / (simulationData.electricFieldX[0][0].length - 1)

                            if (showEnergy) {
                                ctx.strokeStyle = `rgb(${depthColor}, 255, ${depthColor})`
                                ctx.beginPath()
                                ctx.arc(canvasCoords[0], canvasCoords[1], arrowLength * Math.min(1, Math.sqrt(energy / energyScale)), 0, 2 * Math.PI)
                                ctx.stroke()
                            }

                            if (showElectric) {
                                const elClamped = clampMagnitudeVector3D(1, electricValue)

                                const elOffset: [number, number] = [
                                    canvasCoords[0] + arrowLength * elClamped[0],
                                    canvasCoords[1] + arrowLength * elClamped[1],
                                ]

                                drawArrow(ctx, canvasCoords, elOffset, `rgb(255, ${depthColor}, ${depthColor})`)
                            }

                            if (showMagnetic) {
                                const magClamped = clampMagnitudeVector3D(1, magneticValue)

                                const magOffset: [number, number] = [
                                    canvasCoords[0] + arrowLength * magClamped[0],
                                    canvasCoords[1] + arrowLength * magClamped[1],
                                ]

                                drawArrow(ctx, canvasCoords, magOffset, `rgb(${depthColor}, ${depthColor}, 255)`)
                            }

                            if (showPoynting) {
                                const poyntingClamped = clampMagnitudeVector3D(energyScale, poyntingVector)

                                const poyntingOffset: [number, number] = [
                                    canvasCoords[0] + arrowLength * poyntingClamped[0] / energyScale,
                                    canvasCoords[1] + arrowLength * poyntingClamped[1] / energyScale,
                                ]

                                drawArrow(ctx, canvasCoords, poyntingOffset, `rgb(${255 - depthColor}, 255, ${depthColor})`)
                            }
                        }
                    }
                }

                ctx.fillStyle = "white"
                ctx.fillText(`Time: ${simulationData.time.toFixed(2)}`, 10, 10)
                ctx.fillStyle = "lime"
                ctx.fillText(`Total energy: ${totalEnergy.toFixed(2)}`, 10, 20)
                ctx.fillStyle = "red"
                ctx.fillText(`Electric energy: ${totalElectricEnergy.toFixed(2)}`, 10, 30)
                ctx.fillStyle = "blue"
                ctx.fillText(`Magnetic energy: ${totalMagneticEnergy.toFixed(2)}`, 10, 40)
            }
        }
    }, [canvasRef, showElectric, showMagnetic, showEnergy, showPoynting])

    const getSignal = useMemo(() => {
        return (t: number) => {
            const el: Vector3D = [0, 0, t > 2 ? 0 : 20]
            const mag: Vector3D = [0, t > 5 ? 0 : 0, 0]

            return {
                electric: el,
                magnetic: mag
            }
        }
    }, [])

    const step = useCallback(() => {
        let stop = false

        const loop = (async () => {
            while (!stop) {
                const simData = simulator.getData()

                const dt = 0.01

                let sig = getSignal(simData.time)
                for (let z = 0; z < gridSize; z++) {
                    simData.electricFieldX[p][p][z] = sig.electric[0]
                    simData.electricFieldY[p][p][z] = sig.electric[1]
                    simData.electricFieldZ[p][p][z] = sig.electric[2]
                    simData.magneticFieldX[p][p][z] = sig.magnetic[0]
                    simData.magneticFieldY[p][p][z] = sig.magnetic[1]
                    simData.magneticFieldZ[p][p][z] = sig.magnetic[2]
                }
                simulator.stepMagnetic(dt)

                sig = getSignal(simData.time)
                for (let z = 0; z < gridSize; z++) {
                    simData.electricFieldX[p][p][z] = sig.electric[0]
                    simData.electricFieldY[p][p][z] = sig.electric[1]
                    simData.electricFieldZ[p][p][z] = sig.electric[2]
                    simData.magneticFieldX[p][p][z] = sig.magnetic[0]
                    simData.magneticFieldY[p][p][z] = sig.magnetic[1]
                    simData.magneticFieldZ[p][p][z] = sig.magnetic[2]
                }
                simulator.stepElectric(dt)

                redrawCanvas(simulator.getData())
                await new Promise(resolve => setTimeout(resolve, dt * 1000))
            }
        })

        loop()

        return () => { stop = true }
    }, [redrawCanvas, getSignal])

    useEffect(() => {
        redrawCanvas(simulator.getData())
    }, [redrawCanvas])

    useEffect(step, [step])

    return (
        <div>
            <div style={{ float: "left" }}>
                <canvas width={window.innerHeight} height={window.innerHeight} ref={canvasRef} />
            </div>
            <div>
                <div><button onClick={() => setShowElectric(!showElectric)}>Toggle electric</button></div>
                <div><button onClick={() => setShowMagnetic(!showMagnetic)}>Toggle magnetic</button></div>
                <div><button onClick={() => setShowEnergy(!showEnergy)}>Toggle energy</button></div>
                <div><button onClick={() => setShowPoynting(!showPoynting)}>Toggle poynting</button></div>
            </div>
        </div>
    )
}
