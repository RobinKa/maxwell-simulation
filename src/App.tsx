import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { GPU } from "gpu.js"

const gridSize: [number, number, number] = [50, 50, 50]
const cellSize = 0.025
const dt = 0.001

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

const gpu = new GPU({ mode: "gpu" })

const fdCurlX3DA = gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D, magFieldX: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const v = y + 1 >= this.output.y! ? 0 : fieldZ[x][y + 1][z]
    const w = z + 1 >= this.output.x! ? 0 : fieldY[x][y][z + 1]

    return magFieldX[x][y][z] - dt * ((v - fieldZ[x][y][z]) - (w - fieldY[x][y][z])) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })


const fdCurlY3DA = gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D, magFieldY: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u = x + 1 >= this.output.z! ? 0 : fieldZ[x + 1][y][z]
    const w = z + 1 >= this.output.x! ? 0 : fieldX[x][y][z + 1]

    return magFieldY[x][y][z] - dt * ((w - fieldX[x][y][z]) - (u - fieldZ[x][y][z])) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })

const fdCurlZ3DA = gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D, magFieldZ: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u = x + 1 >= this.output.z! ? 0 : fieldY[x + 1][y][z]
    const v = y + 1 >= this.output.y! ? 0 : fieldX[x][y + 1][z]

    return magFieldZ[x][y][z] - dt * ((u - fieldY[x][y][z]) - (v - fieldX[x][y][z])) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })

const fdCurlX3DB = gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D, elFieldX: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const v: number = y - 1 < 0 ? 0 : fieldZ[x][y - 1][z]
    const w: number = z - 1 < 0 ? 0 : fieldY[x][y][z - 1]

    return elFieldX[x][y][z] + dt * ((fieldZ[x][y][z] - v) - (fieldY[x][y][z] - w)) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })

const fdCurlY3DB = gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D, elFieldY: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u: number = x - 1 < 0 ? 0 : fieldZ[x - 1][y][z]
    const w: number = z - 1 < 0 ? 0 : fieldX[x][y][z - 1]

    return elFieldY[x][y][z] + dt * ((fieldX[x][y][z] - w) - (fieldZ[x][y][z] - u)) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })

const fdCurlZ3DB = gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D, elFieldZ: ScalarField3D, dt: number) {
    const x = this.thread.z!
    const y = this.thread.y!
    const z = this.thread.x!

    const u: number = x - 1 < 0 ? 0 : fieldY[x - 1][y][z]
    const v: number = y - 1 < 0 ? 0 : fieldX[x][y - 1][z]

    return elFieldZ[x][y][z] + dt * ((fieldY[x][y][z] - u) - (fieldX[x][y][z] - v)) / (this.constants.cellSize as number)
}, { output: gridSize, constants: { cellSize: cellSize } })

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
        this.data.electricFieldX = fdCurlX3DB(this.data.magneticFieldY, this.data.magneticFieldZ, this.data.electricFieldX, dt) as ScalarField3D
        this.data.electricFieldY = fdCurlY3DB(this.data.magneticFieldX, this.data.magneticFieldZ, this.data.electricFieldY, dt) as ScalarField3D
        this.data.electricFieldZ = fdCurlZ3DB(this.data.magneticFieldX, this.data.magneticFieldY, this.data.electricFieldZ, dt) as ScalarField3D

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        // d/dt B(x, t) = -curl E(x, t)
        this.data.magneticFieldX = fdCurlX3DA(this.data.electricFieldY, this.data.electricFieldZ, this.data.magneticFieldX, dt) as ScalarField3D
        this.data.magneticFieldY = fdCurlY3DA(this.data.electricFieldX, this.data.electricFieldZ, this.data.magneticFieldY, dt) as ScalarField3D
        this.data.magneticFieldZ = fdCurlZ3DA(this.data.electricFieldX, this.data.electricFieldY, this.data.magneticFieldZ, dt) as ScalarField3D

        this.data.time += dt / 2
    }

    getData = () => this.data
}

const simulator = new FDTDSimulator(gridSize)

const canvasSize = [window.innerWidth, window.innerHeight]

const makeRenderSimulatorCanvas = (g: GPU) =>
    g.createKernel(function (electricFieldX: ScalarField3D, electricFieldY: ScalarField3D, electricFieldZ: ScalarField3D, magneticFieldX: ScalarField3D, magneticFieldY: ScalarField3D, magneticFieldZ: ScalarField3D) {
        const x = (this.constants.gridSizeX as number) * this.thread.x! / (this.output.x as number)
        const y = (this.constants.gridSizeY as number) * -this.thread.y! / (this.output.y as number)
        const xb = Math.ceil(x)
        const yb = Math.ceil(y)
        const xa = xb - 1
        const ya = yb - 1

        const alphaX = (x - xa) / (xb - xa)
        const alphaY = (y - ya) / (yb - ya)

        const z = Math.round((this.constants.gridSizeZ as number) / 2)

        const eAA = electricFieldX[xa][ya][z] * electricFieldX[xa][ya][z] + electricFieldY[xa][ya][z] * electricFieldY[xa][ya][z] + electricFieldZ[xa][ya][z] * electricFieldZ[xa][ya][z]
        const eAB = electricFieldX[xa][yb][z] * electricFieldX[xa][yb][z] + electricFieldY[xa][yb][z] * electricFieldY[xa][yb][z] + electricFieldZ[xa][yb][z] * electricFieldZ[xa][yb][z]
        const eBA = electricFieldX[xb][ya][z] * electricFieldX[xb][ya][z] + electricFieldY[xb][ya][z] * electricFieldY[xb][ya][z] + electricFieldZ[xb][ya][z] * electricFieldZ[xb][ya][z]
        const eBB = electricFieldX[xb][yb][z] * electricFieldX[xb][yb][z] + electricFieldY[xb][yb][z] * electricFieldY[xb][yb][z] + electricFieldZ[xb][yb][z] * electricFieldZ[xb][yb][z]

        const mAA = magneticFieldX[xa][ya][z] * magneticFieldX[xa][ya][z] + magneticFieldY[xa][ya][z] * magneticFieldY[xa][ya][z] + magneticFieldZ[xa][ya][z] * magneticFieldZ[xa][ya][z]
        const mAB = magneticFieldX[xa][yb][z] * magneticFieldX[xa][yb][z] + magneticFieldY[xa][yb][z] * magneticFieldY[xa][yb][z] + magneticFieldZ[xa][yb][z] * magneticFieldZ[xa][yb][z]
        const mBA = magneticFieldX[xb][ya][z] * magneticFieldX[xb][ya][z] + magneticFieldY[xb][ya][z] * magneticFieldY[xb][ya][z] + magneticFieldZ[xb][ya][z] * magneticFieldZ[xb][ya][z]
        const mBB = magneticFieldX[xb][yb][z] * magneticFieldX[xb][yb][z] + magneticFieldY[xb][yb][z] * magneticFieldY[xb][yb][z] + magneticFieldZ[xb][yb][z] * magneticFieldZ[xb][yb][z]

        const eMixTop = alphaX * eBA + (1 - alphaX) * eAA
        const eMixBottom = alphaX * eBB + (1 - alphaX) * eAB
        const eMix = Math.max(0, Math.min(2, alphaY * eMixBottom + (1 - alphaY) * eMixTop))

        const mMixTop = alphaX * mBA + (1 - alphaX) * mAA
        const mMixBottom = alphaX * mBB + (1 - alphaX) * mAB
        const mMix = Math.max(0, Math.min(2, alphaY * mMixBottom + (1 - alphaY) * mMixTop))

        this.color(eMix / 2, eMix / 2 * mMix / 2, mMix / 2)
    }, { output: canvasSize, constants: { gridSizeX: gridSize[0], gridSizeY: gridSize[1], gridSizeZ: gridSize[2] }, graphical: true })

function clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

let renderSim: any = null

export default function () {
    const drawCanvasRef = useRef<HTMLCanvasElement>(null)

    const [mouseDownPos, setMouseDownPos] = useState<[number, number] | null>(null)

    const getSignal = useMemo(() => {
        return (t: number) => {
            return [0, 0, 10 * 60]
        }
    }, [])

    const step = useCallback(() => {
        let stop = false

        const loop = (async () => {
            await new Promise(resolve => setTimeout(resolve, 1000 * dt))

            while (!stop) {
                const simData = simulator.getData()


                if (mouseDownPos !== null && drawCanvasRef.current) {
                    const sig = getSignal(simData.time)

                    const px = clamp(0, simData.electricFieldX.length - 1, Math.floor(simData.electricFieldX.length * mouseDownPos[0] / drawCanvasRef.current.width))
                    const py = clamp(0, simData.electricFieldX[0].length - 1, Math.floor(simData.electricFieldX[0].length * mouseDownPos[1] / drawCanvasRef.current.height))

                    for (let z = 0; z < simData.electricFieldX[0][0].length; z++) {
                        simData.electricFieldX[px][py][z] += sig[0] * dt / 2
                        simData.electricFieldY[px][py][z] += sig[1] * dt / 2
                        simData.electricFieldZ[px][py][z] += sig[2] * dt / 2
                    }
                }

                simulator.stepMagnetic(dt)

                if (mouseDownPos !== null && drawCanvasRef.current) {
                    const sig = getSignal(simData.time)

                    const px = clamp(0, simData.electricFieldX.length - 1, Math.floor(simData.electricFieldX.length * mouseDownPos[0] / drawCanvasRef.current.width))
                    const py = clamp(0, simData.electricFieldX[0].length - 1, Math.floor(simData.electricFieldX[0].length * mouseDownPos[1] / drawCanvasRef.current.height))

                    for (let z = 0; z < simData.electricFieldX[0][0].length; z++) {
                        simData.electricFieldX[px][py][z] += sig[0] * dt / 2
                        simData.electricFieldY[px][py][z] += sig[1] * dt / 2
                        simData.electricFieldZ[px][py][z] += sig[2] * dt / 2
                    }
                }

                simulator.stepElectric(dt)

                if (renderSim === null && drawCanvasRef.current !== null) {
                    renderSim = makeRenderSimulatorCanvas(new GPU({ mode: "webgl2", canvas: drawCanvasRef.current }))
                }

                if (renderSim !== null) {
                    renderSim(simData.electricFieldX, simData.electricFieldY, simData.electricFieldZ,
                        simData.magneticFieldX, simData.magneticFieldY, simData.magneticFieldZ)
                }

                await new Promise(resolve => setTimeout(resolve, 1000 * dt))
            }
        })

        loop()

        return () => { stop = true }
    }, [getSignal, mouseDownPos])

    useEffect(step, [step])

    return (
        <canvas width={canvasSize[0]} height={canvasSize[1]} ref={drawCanvasRef}
            onMouseDown={e => setMouseDownPos([e.clientX, e.clientY])}
            onMouseMove={e => { if (mouseDownPos !== null) setMouseDownPos([e.clientX, e.clientY]) }}
            onMouseUp={_ => setMouseDownPos(null)} />
    )
}
