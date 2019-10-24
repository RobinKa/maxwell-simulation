import { SimulatorMap, MaterialMap, SourceDescriptor, SimulationSettings } from "./serialization"

function calcGridSize(gridSizeLongest: number, windowSize: [number, number]): [number, number] {
    const aspectRatio = windowSize[0] / windowSize[1]
    const gridSize = aspectRatio > 1 ?
        [gridSizeLongest, gridSizeLongest / aspectRatio] :
        [gridSizeLongest * aspectRatio, gridSizeLongest]
    return [Math.round(gridSize[0])+1, Math.round(gridSize[1])+1]
}

export function empty(windowSize: [number, number]): SimulatorMap {
    const gridSize = calcGridSize(300, windowSize)

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: gridSize
    }

    for (let y = 0; y < gridSize[1]; y++) {
        materialMap.permittivity.push(new Array(gridSize[0]).fill(1))
        materialMap.permeability.push(new Array(gridSize[0]).fill(1))
    }

    const sourceDescriptors: SourceDescriptor[] = []

    const simulationSettings: SimulationSettings = {
        dt: 0.02,
        cellSize: 0.03,
        gridSize: gridSize,
        simulationSpeed: 1
    }

    return {
        sourcesDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}

export function doubleSlit(windowSize: [number, number]): SimulatorMap {
    const gridSize = calcGridSize(300, windowSize)

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: gridSize
    }

    const slitCenterX = Math.round(0.75 * gridSize[0])

    for (let y = 0; y < gridSize[1]; y++) {
        const isWallRow = Math.abs(y - gridSize[1] / 10) < 2
        const permittivityRow = new Array(gridSize[0]).fill(isWallRow ? 100 : 1)

        if (isWallRow) {
            for (let x = slitCenterX - 10; x < slitCenterX - 5; x++) {
                permittivityRow[x] = 1
            }

            for (let x = slitCenterX + 10; x > slitCenterX + 5; x--) {
                permittivityRow[x] = 1
            }
        }

        materialMap.permittivity.push(permittivityRow)
        materialMap.permeability.push(new Array(gridSize[0]).fill(1))
    }

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 2000000,
        frequency: 3,
        position: [Math.round(slitCenterX), Math.round(gridSize[1] / 15)]
    }]

    const simulationSettings: SimulationSettings = {
        dt: 0.02,
        cellSize: 0.03,
        gridSize: gridSize,
        simulationSpeed: 1
    }

    return {
        sourcesDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}

export function fiberOptics(windowSize: [number, number]): SimulatorMap {
    const gridSize = calcGridSize(300, windowSize)

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: gridSize
    }

    for (let y = 0; y < gridSize[1]; y++) {
        materialMap.permittivity.push(new Array(gridSize[0]).fill(1))
        materialMap.permeability.push(new Array(gridSize[0]).fill(1))
    }

    function getCurvePoint(t: number): [number, number] {
        return [
            Math.round(gridSize[0] * 3 / 4 + gridSize[0] / 5 * 0.5 / (2 * t + 1) * -Math.sin(2 * Math.PI * t)),
            Math.round(gridSize[1] * (1 / 10 + t * (1 - 2 / 10)))
        ]
    }

    const numPoints = 100
    const thickness = 2
    for (let t = 0; t < numPoints; t++) {
        const pos = getCurvePoint(t / numPoints)

        for (let x = -thickness + pos[0]; x < thickness + pos[0]; x++) {
            for (let y = -thickness + pos[1]; y < thickness + pos[1]; y++) {
                if (x >= 0 && y >= 0 && x < gridSize[0] && y < gridSize[1]) {
                    materialMap.permittivity[y][x] = 2
                }
            }
        }
    }

    const endPoint = getCurvePoint(1)

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 2000000,
        frequency: 5,
        position: [endPoint[0] - 1, endPoint[1]],
        turnOffTime: 0.5
    }, {
        type: "point",
        amplitude: 2000000,
        frequency: 5,
        position: [endPoint[0] + 2, endPoint[1]],
        turnOffTime: 0.5
    },]

    const simulationSettings: SimulationSettings = {
        dt: 0.02,
        cellSize: 0.03,
        gridSize: gridSize,
        simulationSpeed: 1
    }

    return {
        sourcesDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}