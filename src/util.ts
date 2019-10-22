type SimulatorMap = {
    permittivity: number[][]
    permeability: number[][]
    shape: [number, number]
}

export function simulatorMapToImageUrl(simulatorMap: SimulatorMap): string {
    const canvas = document.createElement("canvas")
    canvas.width = simulatorMap.shape[0]
    canvas.height = simulatorMap.shape[1]

    const permeability = simulatorMap.permeability
    const permittivity = simulatorMap.permittivity

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

export function imageUrlToSimulatorMap(imageUrl: string, targetSize: [number, number], onLoaded: (simulatorMap: SimulatorMap) => void) {
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

        const map: SimulatorMap = { permeability: [], permittivity: [], shape: targetSize }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        for (let y = 0; y < targetSize[1]; y++) {
            map.permittivity.push([])
            map.permeability.push([])
            for (let x = 0; x < targetSize[0]; x++) {
                map.permittivity[y].push(Math.max(1, imageData[x * 4 + y * targetSize[0] * 4 + 0]))
                map.permeability[y].push(Math.max(1, imageData[x * 4 + y * targetSize[0] * 4 + 2]))
            }
        }

        onLoaded(map)
    }
    image.src = imageUrl
}

export function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
    } else if (document.exitFullscreen) {
        document.exitFullscreen()
    }
}