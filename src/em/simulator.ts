import { Regl, Framebuffer2D, DrawCommand } from "regl"
import * as k from "./kernels/simulation"
import { DrawInfo } from "./drawing"

export type MaterialType = "permittivity" | "permeability" | "conductivity"

function clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

export function combineMaterialMaps(permittivity: number[][],
    permeability: number[][], conductivity: number[][]): number[][][] {
    const material: number[][][] = [];
    const width = permittivity[0].length;
    const height = permittivity.length;

    // TODO: Verify same dims

    for (let y = 0; y < height; y++) {
        const row: number[][] = []

        for (let x = 0; x < width; x++) {
            row.push([
                clamp(0, 255, 128 + 10 * permittivity[y][x]),
                clamp(0, 255, 128 + 10 * permeability[y][x]),
                clamp(0, 255, 128 + 10 * conductivity[y][x]),
            ])
        }

        material.push(row)
    }

    return material
}

class DoubleFramebuffer2D {
    current: Framebuffer2D
    previous: Framebuffer2D

    constructor(current: Framebuffer2D, previous: Framebuffer2D) {
        this.current = current
        this.previous = previous
    }

    swap() {
        const oldCurrent = this.current
        this.current = this.previous
        this.previous = oldCurrent
    }
}

export type SimulationData = {
    time: number
    electricField: DoubleFramebuffer2D
    magneticField: DoubleFramebuffer2D
    material: DoubleFramebuffer2D
    alphaBetaField: Framebuffer2D
    electricSourceField: DoubleFramebuffer2D
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    resetFields: () => void
    resetMaterials: () => void
    injectSignal: (drawInfo: DrawInfo, dt: number) => void
    getData: () => SimulationData
    getCellSize: () => number
    setCellSize: (cellSize: number) => void
    getGridSize: () => [number, number]
    setGridSize: (gridSize: [number, number]) => void
    getReflectiveBoundary: () => boolean
    setReflectiveBoundary: (reflectiveBoundary: boolean) => void
}

export class FDTDSimulator implements Simulator {
    private data: SimulationData

    private updateMagnetic: DrawCommand
    private updateElectric: DrawCommand
    private updateAlphaBeta: DrawCommand

    private injectSource: DrawCommand
    private decaySource: DrawCommand

    private drawOnTexture: { [shape: string]: DrawCommand }

    private copyToMaterial: DrawCommand

    private frameBuffers: Framebuffer2D[]
    private alphaBetaDt: number // dt that the alpha beta values were calculated for

    constructor(readonly regl: Regl, private gridSize: [number, number], private cellSize: number, public reflectiveBoundary: boolean, private dt: number) {
        this.alphaBetaDt = dt

        this.frameBuffers = []

        const makeFrameBuffer = () => {
            // Create half-precision texture at grid size
            const fbo = regl.framebuffer({
                color: regl.texture({
                    width: gridSize[0],
                    height: gridSize[1],
                    wrap: "clamp",
                    type: "float16",
                    format: "rgba",
                    min: "nearest",
                    mag: "nearest",
                }),
                depthStencil: false
            })

            // Keep track of all fbos so we can resize them
            // together if the grid size changes.
            this.frameBuffers.push(fbo)

            return fbo
        }

        const makeField = () => {
            return new DoubleFramebuffer2D(
                makeFrameBuffer(),
                makeFrameBuffer()
            )
        }

        this.data = {
            time: 0,
            electricField: makeField(),
            magneticField: makeField(),
            electricSourceField: makeField(),
            material: makeField(),
            alphaBetaField: makeFrameBuffer()
        }

        const makeFragFn = <T>(frag: string, fbos: { current: Framebuffer2D }, uniforms: T) => {
            return regl({
                frag: frag,
                framebuffer: () => fbos.current,
                uniforms: uniforms,

                attributes: {
                    position: [
                        [1, -1],
                        [1, 1],
                        [-1, -1],
                        [-1, 1]
                    ]
                },
                vert: k.vert,
                count: 4,
                primitive: "triangle strip",
                depth: { enable: false }
            })
        }

        const makeFragWithFboPropFn = (frag: string, uniforms: any) => {
            return regl({
                frag: frag,
                framebuffer: (_: any, prop: any) => prop.fbo,
                uniforms: uniforms,

                attributes: {
                    position: [
                        [1, -1],
                        [1, 1],
                        [-1, -1],
                        [-1, 1]
                    ]
                },
                vert: k.vert,
                count: 4,
                primitive: "triangle strip",
                depth: { enable: false }
            })
        }

        this.updateAlphaBeta = makeFragFn(k.updateAlphaBeta, { current: this.data.alphaBetaField }, {
            dt: (_: any, props: any) => props.dt,
            cellSize: (_: any, props: any) => props.cellSize,
            material: (_: any, props: any) => props.material,
        })

        this.updateElectric = makeFragFn(k.updateElectric, this.data.electricField, {
            electricField: (_: any, props: any) => props.electricField,
            magneticField: (_: any, props: any) => props.magneticField,
            alphaBetaField: (_: any, props: any) => props.alphaBetaField,
            relativeCellSize: (_: any, props: any) => props.relativeCellSize,
            reflectiveBoundary: (_: any, props: any) => props.reflectiveBoundary,
        })

        this.updateMagnetic = makeFragFn(k.updateMagnetic, this.data.magneticField, {
            electricField: (_: any, props: any) => props.electricField,
            magneticField: (_: any, props: any) => props.magneticField,
            alphaBetaField: (_: any, props: any) => props.alphaBetaField,
            relativeCellSize: (_: any, props: any) => props.relativeCellSize,
            reflectiveBoundary: (_: any, props: any) => props.reflectiveBoundary,
        })

        this.injectSource = makeFragFn(k.injectSource, this.data.electricField, {
            sourceField: (_: any, props: any) => props.sourceField,
            field: (_: any, props: any) => props.field,
            dt: (_: any, props: any) => props.dt,
        })

        this.decaySource = makeFragFn(k.decaySource, this.data.electricSourceField, {
            sourceField: (_: any, props: any) => props.sourceField,
            dt: (_: any, props: any) => props.dt,
        })

        this.drawOnTexture = {
            "circle": makeFragWithFboPropFn(k.drawCircle, {
                texture: (_: any, props: any) => props.texture,
                pos: (_: any, props: any) => props.pos,
                value: (_: any, props: any) => props.value,
                radius: (_: any, props: any) => props.radius,
                keep: (_: any, props: any) => props.keep,
            }),
            "square": makeFragWithFboPropFn(k.drawSquare, {
                texture: (_: any, props: any) => props.texture,
                pos: (_: any, props: any) => props.pos,
                value: (_: any, props: any) => props.value,
                size: (_: any, props: any) => props.size,
                keep: (_: any, props: any) => props.keep,
            }),
        }

        this.copyToMaterial = makeFragFn(k.copy, this.data.material, {
            texture: (_: any, props: any) => props.texture
        })

        this.resetFields()
        this.resetMaterials()
    }

    updateAlphaBetaFromMaterial(dt: number) {
        this.alphaBetaDt = dt
        this.updateAlphaBeta({
            material: this.data.material.current,
            dt: dt,
            cellSize: this.cellSize
        })
    }

    getGridSize = () => this.gridSize;
    setGridSize = (gridSize: [number, number]) => {
        this.gridSize = gridSize

        this.frameBuffers.forEach(frameBuffer => frameBuffer.resize(gridSize[0], gridSize[1]))

        // TODO: Copy old data ?

        this.resetFields()
    }

    getCellSize = () => this.cellSize;
    setCellSize = (cellSize: number) => {
        this.cellSize = cellSize

        this.resetFields()
    }

    getReflectiveBoundary = () => this.reflectiveBoundary;
    setReflectiveBoundary = (reflectiveBoundary: boolean) => {
        this.reflectiveBoundary = reflectiveBoundary
    }

    stepElectric = (dt: number) => {
        if (this.alphaBetaDt !== dt) {
            this.updateAlphaBetaFromMaterial(dt)
        }

        this.data.electricField.swap()
        this.data.electricSourceField.swap()

        // Writes to E current
        this.injectSource({
            sourceField: this.data.electricSourceField.previous,
            field: this.data.electricField.previous,
            dt: dt
        })

        this.data.electricField.swap()

        // Writes to S current
        this.decaySource({
            sourceField: this.data.electricSourceField.previous,
            dt: dt
        })

        // Writes to E current
        this.updateElectric({
            electricField: this.data.electricField.previous,
            magneticField: this.data.magneticField.current,
            alphaBetaField: this.data.alphaBetaField,
            relativeCellSize: [1 / this.gridSize[0], 1 / this.gridSize[1]],
            reflectiveBoundary: this.reflectiveBoundary,
        })

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        if (this.alphaBetaDt !== dt) {
            this.updateAlphaBetaFromMaterial(dt)
        }

        this.data.magneticField.swap()

        this.updateMagnetic({
            electricField: this.data.electricField.current,
            magneticField: this.data.magneticField.previous,
            alphaBetaField: this.data.alphaBetaField,
            relativeCellSize: [1 / this.gridSize[0], 1 / this.gridSize[1]],
            reflectiveBoundary: this.reflectiveBoundary,
        })

        this.data.time += dt / 2
    }

    resetFields = () => {
        this.data.time = 0

        this.regl.clear({
            color: [0, 0, 0, 0],
            framebuffer: this.data.electricField.current
        })

        this.regl.clear({
            color: [0, 0, 0, 0],
            framebuffer: this.data.magneticField.current
        })

        this.regl.clear({
            color: [0, 0, 0, 0],
            framebuffer: this.data.electricSourceField.current
        })
    }

    resetMaterials = () => {
        this.regl.clear({
            color: [1, 1, 0, 0],
            framebuffer: this.data.material.current
        })

        this.updateAlphaBetaFromMaterial(this.alphaBetaDt)
    }

    drawMaterial = (materialType: MaterialType, drawInfo: DrawInfo) => {
        this.data.material.swap()

        const value = [0, 0, 0, 0]
        const keep = [1, 1, 1, 1]
        if (materialType === "permittivity") {
            value[0] = drawInfo.value
            keep[0] = 0
        } else if (materialType === "permeability") {
            value[1] = drawInfo.value
            keep[1] = 0
        } else if (materialType === "conductivity") {
            value[2] = drawInfo.value
            keep[2] = 0
        }

        const uniforms: any = {
            pos: drawInfo.center,
            value: value,
            keep: keep,
            texture: this.data.material.previous,
            fbo: this.data.material.current
        }

        if (drawInfo.drawShape === "circle") {
            uniforms.radius = drawInfo.radius
        } else if (drawInfo.drawShape === "square") {
            uniforms.size = drawInfo.halfSize
        }

        this.drawOnTexture[drawInfo.drawShape](uniforms)

        this.updateAlphaBetaFromMaterial(this.alphaBetaDt)
    }

    injectSignal = (drawInfo: DrawInfo, dt: number) => {
        this.data.electricSourceField.swap()

        const uniforms: any = {
            pos: drawInfo.center,
            value: [0, 0, drawInfo.value * dt, 0],
            keep: [1, 1, 1, 1],
            texture: this.data.electricSourceField.previous,
            fbo: this.data.electricSourceField.current
        }

        if (drawInfo.drawShape === "circle") {
            uniforms.radius = drawInfo.radius
        } else if (drawInfo.drawShape === "square") {
            uniforms.size = drawInfo.halfSize
        }

        this.drawOnTexture[drawInfo.drawShape](uniforms)
    }

    loadMaterial = (material: number[][][]) => {
        const materialTexture = this.regl.texture({
            data: material,
            format: "rgb",
            type: "uint8",
            min: "nearest",
            mag: "nearest",
        })

        this.copyToMaterial({
            texture: materialTexture
        })

        this.updateAlphaBetaFromMaterial(this.alphaBetaDt)
    }

    loadMaterialFromComponents = (permittivity: number[][], permeability: number[][], conductivity: number[][]) => {
        this.loadMaterial(
            combineMaterialMaps(permittivity, permeability, conductivity)
        )
    }

    getData = () => this.data
}
