import React, { useRef, useCallback, useEffect, useMemo } from 'react'

type Vector3D = [number, number, number]

type Field3D<T> = T[][][]
type ScalarField3D = Field3D<number>
type VectorField3D = Field3D<Vector3D>

function fieldAt3D<T>(field: Field3D<T>, coords: [number, number, number], outOfRange: T) {
    const xs = field[coords[0]]

    if (xs === undefined) {
        return outOfRange
    }

    const ys = xs[coords[1]]

    if (ys === undefined) {
        return outOfRange
    }

    const value = ys[coords[2]]

    if (value === undefined) {
        return outOfRange
    }

    return value
}

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

function fdCurl3D(field: VectorField3D, out: VectorField3D) {
    for (let x = 0; x < field.length; x++) {
        for (let y = 0; y < field[0].length; y++) {
            for (let z = 0; z < field[0][0].length; z++) {
                const left = fieldAt3D(field, [x - 1, y, z], [0, 0, 0])
                const right = fieldAt3D(field, [x + 1, y, z], [0, 0, 0])

                const top = fieldAt3D(field, [x, y - 1, z], [0, 0, 0])
                const bottom = fieldAt3D(field, [x, y + 1, z], [0, 0, 0])

                const front = fieldAt3D(field, [x, y, z - 1], [0, 0, 0])
                const back = fieldAt3D(field, [x, y, z + 1], [0, 0, 0])

                out[x][y][z][0] = 0.5 * ((bottom[2] - top[2]) - (back[1] - front[1]))
                out[x][y][z][1] = 0.5 * ((back[0] - front[0]) - (right[2] - left[2]))
                out[x][y][z][2] = 0.5 * ((right[1] - left[1]) - (bottom[0] - top[0]))
            }
        }
    }
}

function inplaceMulAddVectorField3D(a: VectorField3D, b: VectorField3D, s: number) {
    for (let x = 0; x < a.length; x++) {
        for (let y = 0; y < a[0].length; y++) {
            for (let z = 0; z < a[0][0].length; z++) {
                for (let d = 0; d < 3; d++) {
                    a[x][y][z][d] += s * b[x][y][z][d]
                }
            }
        }
    }
}

type SimulationData = {
    electricField: VectorField3D
    magneticField: VectorField3D
    permittivity: ScalarField3D
    permeability: ScalarField3D
}

interface Simulator {
    step: (dt: number) => void
    getData: () => SimulationData
}

class FDTDSimulator implements Simulator {
    private data: SimulationData

    private auxCurl: VectorField3D

    constructor(shape: [number, number, number]) {
        this.data = {
            electricField: makeField3D<Vector3D>(shape, (_) => [0, 0, 0]),
            magneticField: makeField3D<Vector3D>(shape, (_) => [0, 0, 0]),
            permittivity: makeField3D<number>(shape, (_) => 0),
            permeability: makeField3D<number>(shape, (_) => 0),
        }

        this.auxCurl = makeField3D<Vector3D>(shape, (_) => [0, 0, 0])
    }

    step = (dt: number) => {
        const halfDt = dt / 2

        // d/dt B(x, t) = -curl E(x, t)
        fdCurl3D(this.data.electricField, this.auxCurl)
        inplaceMulAddVectorField3D(this.data.magneticField, this.auxCurl, -halfDt)

        // d/dt E(x, t) = (curl B(x, t))/(µε)
        fdCurl3D(this.data.magneticField, this.auxCurl)
        inplaceMulAddVectorField3D(this.data.electricField, this.auxCurl, halfDt)
    }

    getData = () => this.data
}

const gridSize = 5
const p = 2

const simulator = new FDTDSimulator([gridSize, gridSize, gridSize])

simulator.getData().electricField[p][p][p][1] = 10
simulator.getData().electricField[p][p][p][0] = 10
simulator.getData().magneticField[p][p][p][2] = 10

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

function Clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

export default function () {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    const redrawCanvas = useMemo(() => (simulationData: SimulationData) => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d")
            if (ctx) {
                ctx.fillStyle = "black"
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

                const simulationData = simulator.getData()

                const cellSize = ctx.canvas.width / simulationData.electricField.length
                const arrowLength = cellSize / 2.5

                for (let x = 0; x < simulationData.electricField.length; x++) {
                    for (let y = 0; y < simulationData.electricField[0].length; y++) {
                        for (let z = 0; z < simulationData.electricField[0][0].length; z++) {
                            const canvasCoords: [number, number] = [
                                (x + 0.5) * cellSize + cellSize * z / (4 * simulationData.electricField.length),
                                (y + 0.5) * cellSize - cellSize * z / (4 * simulationData.electricField.length)
                            ]

                            const electricValue = simulationData.electricField[x][y][z]
                            const electricMag = Math.sqrt(electricValue[0] * electricValue[0] + electricValue[1] * electricValue[1] + electricValue[2] * electricValue[2])
                            const magneticValue = simulationData.magneticField[x][y][z]
                            const magneticMag = Math.sqrt(magneticValue[0] * magneticValue[0] + magneticValue[1] * magneticValue[1] + magneticValue[2] * magneticValue[2])

                            const energy = electricMag * electricMag + magneticMag * magneticMag

                            const depthColor = 255 * z / (simulationData.electricField[0][0].length - 1)

                            ctx.strokeStyle = `rgb(${depthColor}, 255, ${depthColor})`
                            ctx.beginPath()
                            ctx.arc(canvasCoords[0], canvasCoords[1], arrowLength * Math.min(1, energy / 10), 0, 2 * Math.PI)
                            ctx.stroke()

                            const elOffset: [number, number] = [
                                canvasCoords[0] + arrowLength * Clamp(-1, 1, electricValue[0]),
                                canvasCoords[1] + arrowLength * Clamp(-1, 1, electricValue[1]),
                            ]

                            drawArrow(ctx, canvasCoords, elOffset, `rgb(255, ${depthColor}, ${depthColor})`)
                        

                            const magOffset: [number, number] = [
                                canvasCoords[0] + arrowLength * Clamp(-1, 1, magneticValue[0]),
                                canvasCoords[1] + arrowLength * Clamp(-1, 1, magneticValue[1]),
                            ]

                            drawArrow(ctx, canvasCoords, magOffset, `rgb(${depthColor}, ${depthColor}, 255)`)
                        }
                    }
                }
            }
        }
    }, [canvasRef])

    const step = useCallback(() => {
        (async () => {
            while (true) {
                simulator.step(0.01)
                redrawCanvas(simulator.getData())
                await new Promise(resolve => setTimeout(resolve, 10))
            }
        })()
    }, [redrawCanvas])

    useEffect(() => {
        redrawCanvas(simulator.getData())
    }, [redrawCanvas])

    useEffect(step, [step])

    return (
        <div>
            <canvas width={1000} height={1000} ref={canvasRef} />
        </div>
    )
}
