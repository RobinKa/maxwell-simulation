export type SimulationSettings = {
    dt: number
    gridSize: [number, number]
    simulationSpeed: number
    cellSize: number
}

export type MaterialMap = {
    permittivity: number[][]
    permeability: number[][]
    shape: [number, number]
}

export type EncodedMaterialMap = string

export type SourceDescriptor = {
    type: "point"
    position: [number, number]
    amplitude: number
    frequency: number
    turnOffTime?: number
}

export type SimulatorMap = {
    materialMap: MaterialMap
    simulationSettings: SimulationSettings
    sourcesDescriptors: SourceDescriptor[]
}

export function encodeMaterialMap(materialMap: MaterialMap): string {
    const canvas = document.createElement("canvas")
    canvas.width = materialMap.shape[0]
    canvas.height = materialMap.shape[1]

    const permeability = materialMap.permeability
    const permittivity = materialMap.permittivity

    const ctx = canvas.getContext("2d")!

    ctx.fillStyle = "rgb(1, 0, 1)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = "rgb(0, 255, 0)"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("warlock.ai/maxwell", canvas.width / 2, canvas.height / 2)

    const canvasData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    for (let x = 0; x < canvas.width; x++) {
        for (let y = 0; y < canvas.height; y++) {
            canvasData.data[x * 4 + y * canvas.width * 4 + 0] = Math.round(permittivity[y][x]) // r
            canvasData.data[x * 4 + y * canvas.width * 4 + 2] = Math.round(permeability[y][x]) // b
            canvasData.data[x * 4 + y * canvas.width * 4 + 3] = 255 // a
        }
    }

    ctx.putImageData(canvasData, 0, 0)

    return canvas.toDataURL("image/png")
}

export function decodeMaterialMap(encodedMaterialMap: EncodedMaterialMap, targetSize: [number, number], onLoaded: (materialMap: MaterialMap) => void) {
    const canvas = document.createElement("canvas")
    canvas.width = targetSize[0]
    canvas.height = targetSize[1]
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = e => {
        const ctx = canvas.getContext("2d")!

        ctx.fillStyle = "rgb(1, 0, 1)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        ctx.drawImage(image, 0, 0, image.width, image.height)

        const materialMap: MaterialMap = { permeability: [], permittivity: [], shape: targetSize }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        for (let y = 0; y < targetSize[1]; y++) {
            materialMap.permittivity.push([])
            materialMap.permeability.push([])
            for (let x = 0; x < targetSize[0]; x++) {
                materialMap.permittivity[y].push(Math.max(1, imageData[x * 4 + y * targetSize[0] * 4 + 0]))
                materialMap.permeability[y].push(Math.max(1, imageData[x * 4 + y * targetSize[0] * 4 + 2]))
            }
        }

        onLoaded(materialMap)
    }
    image.src = encodedMaterialMap
}