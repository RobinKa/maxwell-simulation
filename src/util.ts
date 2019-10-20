type SimulatorMap = {
    permittivity: number[]
    permeability: number[]
    shape: [number, number]
}

export function simulatorMapToImageUrl(simulatorMap: SimulatorMap): string {
    const canvas = document.createElement("canvas")
    canvas.width = simulatorMap.shape[0]
    canvas.height = simulatorMap.shape[1]

    const permeability = simulatorMap.permeability
    const permittivity = simulatorMap.permittivity

    const ctx = canvas.getContext("2d")!

    ctx.fillStyle = "black"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = "rgb(0, 255, 0)"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("warlock.ai/maxwell", canvas.width / 2, canvas.height / 2)

    const canvasData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    for (let x = 0; x < canvas.width; x++) {
        for (let y = 0; y < canvas.height; y++) {
            canvasData.data[x * 4 + y * canvas.width * 4 + 0] = Math.round(permittivity[x + y * canvas.width]) // r
            canvasData.data[x * 4 + y * canvas.width * 4 + 2] = Math.round(permeability[x + y * canvas.width]) // b
            canvasData.data[x * 4 + y * canvas.width * 4 + 3] = 255 // a
        }
    }

    ctx.putImageData(canvasData, 0, 0)

    return canvas.toDataURL("image/png")
}

export function imageUrlToSimulatorMap(imageUrl: string, targetSize: [number, number], onLoaded: (simulatorMap: SimulatorMap) => void) {
    const canvas = document.createElement("canvas")
    canvas.width = targetSize[0]
    canvas.height = targetSize[1]
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = e => {
        const ctx = canvas.getContext("2d")!

        ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height)

        const map: SimulatorMap = { permeability: [], permittivity: [], shape: targetSize }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        for (let x = 0; x < targetSize[0]; x++) {
            for (let y = 0; y < targetSize[1]; y++) {
                map.permittivity[x + y * targetSize[0]] = imageData[x * 4 + y * targetSize[0] * 4 + 0]
                map.permeability[x + y * targetSize[0]] = imageData[x * 4 + y * targetSize[0] * 4 + 2]
            }
        }

        onLoaded(map)
    }
    image.src = imageUrl
}