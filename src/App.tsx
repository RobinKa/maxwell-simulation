import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import { GPU } from "gpu.js"
import { ScalarField3D, FDTDSimulator } from "./simulator"

const canvasSize = [window.innerWidth, window.innerHeight]

const dt = 0.005
const gridSizeX = 120
const gridSize: [number, number, number] = [gridSizeX, Math.ceil(gridSizeX / canvasSize[0] * canvasSize[1]), 1]
const cellSize = 0.01

const simulator = new FDTDSimulator(gridSize, cellSize)

const makeRenderSimulatorCanvas = (g: GPU) =>
    g.createKernel(function (electricFieldX: ScalarField3D, electricFieldY: ScalarField3D, electricFieldZ: ScalarField3D, magneticFieldX: ScalarField3D, magneticFieldY: ScalarField3D, magneticFieldZ: ScalarField3D) {
        const x = (this.constants.gridSizeX as number) * this.thread.x! / (this.output.x as number)
        const y = (this.constants.gridSizeY as number) * this.thread.y! / (this.output.y as number)
        const xa = Math.floor(x)
        const ya = Math.floor(y)
        const xb = xa + 1
        const yb = ya + 1

        const alphaX = xb === xa ? 0 : (x - xa) / (xb - xa)
        const alphaY = yb === ya ? 0 : (y - ya) / (yb - ya)

        const z = Math.round((this.constants.gridSizeZ as number) / 2)

        const eAA = electricFieldX[xa][ya][z] * electricFieldX[xa][ya][z] + electricFieldY[xa][ya][z] * electricFieldY[xa][ya][z] + electricFieldZ[xa][ya][z] * electricFieldZ[xa][ya][z]
        const eAB = electricFieldX[xa][yb][z] * electricFieldX[xa][yb][z] + electricFieldY[xa][yb][z] * electricFieldY[xa][yb][z] + electricFieldZ[xa][yb][z] * electricFieldZ[xa][yb][z]
        const eBA = electricFieldX[xb][ya][z] * electricFieldX[xb][ya][z] + electricFieldY[xb][ya][z] * electricFieldY[xb][ya][z] + electricFieldZ[xb][ya][z] * electricFieldZ[xb][ya][z]
        const eBB = electricFieldX[xb][yb][z] * electricFieldX[xb][yb][z] + electricFieldY[xb][yb][z] * electricFieldY[xb][yb][z] + electricFieldZ[xb][yb][z] * electricFieldZ[xb][yb][z]

        // Magnetic field is offset from electric field, so get value at +0.5 by interpolating 0 and 1
        const magXAA = (magneticFieldX[xa][ya][z] + magneticFieldX[xa+1][ya+1][z]) / 2
        const magYAA = (magneticFieldY[xa][ya][z] + magneticFieldY[xa+1][ya+1][z]) / 2
        const magZAA = (magneticFieldZ[xa][ya][z] + magneticFieldZ[xa+1][ya+1][z]) / 2
        const magXAB = (magneticFieldX[xa][yb][z] + magneticFieldX[xa+1][yb+1][z]) / 2
        const magYAB = (magneticFieldY[xa][yb][z] + magneticFieldY[xa+1][yb+1][z]) / 2
        const magZAB = (magneticFieldZ[xa][yb][z] + magneticFieldZ[xa+1][yb+1][z]) / 2
        const magXBA = (magneticFieldX[xb][ya][z] + magneticFieldX[xb+1][ya+1][z]) / 2
        const magYBA = (magneticFieldY[xb][ya][z] + magneticFieldY[xb+1][ya+1][z]) / 2
        const magZBA = (magneticFieldZ[xb][ya][z] + magneticFieldZ[xb+1][ya+1][z]) / 2
        const magXBB = (magneticFieldX[xb][yb][z] + magneticFieldX[xb+1][yb+1][z]) / 2
        const magYBB = (magneticFieldY[xb][yb][z] + magneticFieldY[xb+1][yb+1][z]) / 2
        const magZBB = (magneticFieldZ[xb][yb][z] + magneticFieldZ[xb+1][yb+1][z]) / 2

        const mAA = magXAA * magXAA + magYAA * magYAA + magZAA * magZAA
        const mAB = magXAB * magXAB + magYAB * magYAB + magZAB * magZAB
        const mBA = magXBA * magXBA + magYBA * magYBA + magZBA * magZBA
        const mBB = magXBB * magXBB + magYBB * magYBB + magZBB * magZBB

        const eMixTop = alphaX * eBA + (1 - alphaX) * eAA
        const eMixBottom = alphaX * eBB + (1 - alphaX) * eAB
        const eMix = Math.max(0, Math.min(25, alphaY * eMixBottom + (1 - alphaY) * eMixTop))

        const mMixTop = alphaX * mBA + (1 - alphaX) * mAA
        const mMixBottom = alphaX * mBB + (1 - alphaX) * mAB

        const mMix = Math.max(0, Math.min(25, alphaY * mMixBottom + (1 - alphaY) * mMixTop))

        this.color(eMix / 25, 0, mMix / 25)
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
            return [0, 0, 50 * 60]
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
            onMouseDown={e => setMouseDownPos([e.clientX, canvasSize[1] - e.clientY])}
            onMouseMove={e => { if (mouseDownPos !== null) setMouseDownPos([e.clientX, canvasSize[1] - e.clientY]) }}
            onMouseUp={_ => setMouseDownPos(null)} />
    )
}
