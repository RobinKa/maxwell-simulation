import * as k from "./kernels/rendering"
import REGL, { Regl, Framebuffer2D } from 'regl'

export function createReglFromCanvas(canvas: HTMLCanvasElement) {
    return REGL({
        canvas: canvas,
        extensions: [
            "OES_texture_half_float",
        ],
        optionalExtensions: [
            "OES_texture_half_float_linear",
            // Shows a warning without this. However making it
            // non-optional would make it crash on iPad 6 even
            // though it works.
            "EXT_color_buffer_half_float"
        ]
    })
}

export function makeRenderSimulatorCanvas(regl: Regl, canvasSize: [number, number], gridSize: [number, number]) {
    const filter = regl.hasExtension("OES_texture_half_float_linear") ? "linear" : "nearest"

    const frameBuffers: Framebuffer2D[] = []

    const makeFrameBuffer = () => {
        // Create half-precision texture at canvas size
        const fbo = regl.framebuffer({
            color: regl.texture({
                width: canvasSize[0],
                height: canvasSize[1],
                wrap: "clamp",
                type: "float16",
                format: "rgba",
                min: filter,
                mag: filter
            }),
            depthStencil: false
        })

        // Keep track of all frame buffers so we can
        // resize them when the canvas size changes.
        frameBuffers.push(fbo)

        return fbo
    }

    const fbos = [makeFrameBuffer(), makeFrameBuffer()]
    const energyFbo = makeFrameBuffer()
    const backgroundFbo = makeFrameBuffer()

    type RenderBackgroundUniforms = {
        gridSize: [number, number]
    }

    const renderBackground = regl<RenderBackgroundUniforms, {}, RenderBackgroundUniforms>({
        frag: k.renderBackground,
        framebuffer: backgroundFbo,
        uniforms: {
            gridSize: (_, { gridSize }) => gridSize
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    type RenderEnergyUniforms = {
        brightness: number
        electricField: Framebuffer2D
        magneticField: Framebuffer2D
        material: Framebuffer2D
        electricEnergyFactor: number
        magneticEnergyFactor: number
    }

    type RenderEnergyAttributes = {
        position: number[][]
    }

    const renderEnergy = regl<RenderEnergyUniforms, RenderEnergyAttributes, RenderEnergyUniforms>({
        frag: k.renderEnergy,
        framebuffer: energyFbo,
        uniforms: {
            brightness: (_, { brightness }) => brightness,
            electricField: (_, { electricField }) => electricField,
            magneticField: (_, { magneticField }) => magneticField,
            material: (_, { material }) => material,
            electricEnergyFactor: (_, { electricEnergyFactor }) => electricEnergyFactor,
            magneticEnergyFactor: (_, { magneticEnergyFactor }) => magneticEnergyFactor,
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    type BloomExtractUniforms = {
        texture: Framebuffer2D
        threshold: number
    }

    const bloomExtract = regl<BloomExtractUniforms, {}, BloomExtractUniforms>({
        frag: k.bloomExtract,
        framebuffer: fbos[0],
        uniforms: {
            texture: () => energyFbo,
            threshold: (_, { threshold }) => threshold,
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    const blurVert = regl<{ texture: Framebuffer2D, direction: [number, number] }, {}, { texture: Framebuffer2D }>({
        frag: k.blurDirectional,
        framebuffer: fbos[1],
        uniforms: {
            texture: (_, { texture }) => texture,
            direction: ctx => [1 / ctx.drawingBufferHeight, 0]
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    const blurHor = regl({
        frag: k.blurDirectional,
        framebuffer: fbos[0],
        uniforms: {
            texture: fbos[1],
            direction: ctx => [0, 1 / ctx.drawingBufferHeight]
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    type DrawUniforms = {
        energyTexture: Framebuffer2D
        bloomTexture: Framebuffer2D
        materialTexture: Framebuffer2D
        backgroundTexture: Framebuffer2D
    }

    const draw = regl<DrawUniforms, {}, DrawUniforms>({
        frag: k.draw,
        uniforms: {
            energyTexture: (_, { energyTexture }) => energyTexture,
            bloomTexture: (_, { bloomTexture }) => bloomTexture,
            materialTexture: (_, { materialTexture }) => materialTexture,
            backgroundTexture: (_, { backgroundTexture }) => backgroundTexture,
        },

        attributes: {
            position: [
                [1, -1],
                [1, 1],
                [-1, -1],
                [-1, 1]
            ]
        },
        vert: k.vertDraw,
        count: 4,
        primitive: "triangle strip",
        depth: { enable: false }
    })

    function render(electricField: Framebuffer2D, magneticField: Framebuffer2D,
        material: Framebuffer2D, cellSize: number, gridSize: [number, number],
        showElectric: boolean, showMagnetic: boolean) {
        renderEnergy({
            brightness: 0.02 * 0.02 / (cellSize * cellSize),
            electricField: electricField,
            magneticField: magneticField,
            material: material,
            electricEnergyFactor: showElectric ? 1 : 0,
            magneticEnergyFactor: showMagnetic ? 1 : 0
        })

        bloomExtract({
            threshold: 1
        })

        const blurCount = 3
        for (let i = 0; i < blurCount; i++) {
            blurVert({
                texture: i === 0 ? energyFbo : fbos[0]
            })
            blurHor()
        }

        draw({
            energyTexture: energyFbo,
            bloomTexture: fbos[0],
            materialTexture: material,
            backgroundTexture: backgroundFbo
        })
    }

    renderBackground({
        gridSize: gridSize
    })

    return {
        render: render,
        adjustCanvasSize: (size: [number, number]) => {
            frameBuffers.forEach(fbo => fbo.resize(size[0], size[1]))
            regl.poll()
        },
        adjustGridSize: (gridSize: [number, number]) => {
            renderBackground({
                gridSize: gridSize
            })
        }
    }
}