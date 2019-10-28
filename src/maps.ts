import { SimulatorMap, MaterialMap, SourceDescriptor, SimulationSettings } from "./serialization"

export function empty(simulationSettings: SimulationSettings): SimulatorMap {
    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: simulationSettings.gridSize
    }

    for (let y = 0; y < simulationSettings.gridSize[1]; y++) {
        materialMap.permittivity.push(new Array(simulationSettings.gridSize[0]).fill(1))
        materialMap.permeability.push(new Array(simulationSettings.gridSize[0]).fill(1))
    }

    const sourceDescriptors: SourceDescriptor[] = []

    return {
        sourceDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}

export function doubleSlit(simulationSettings: SimulationSettings): SimulatorMap {
    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: simulationSettings.gridSize
    }

    const slitCenterX = Math.round(0.5 * simulationSettings.gridSize[0])

    const slitSize = 0.2 / simulationSettings.cellSize

    for (let y = 0; y < simulationSettings.gridSize[1]; y++) {
        const isWallRow = Math.abs(y - simulationSettings.gridSize[1] / 5) < 2
        const permittivityRow = new Array(simulationSettings.gridSize[0]).fill(isWallRow ? 100 : 1)

        if (isWallRow) {
            for (let x = slitCenterX - slitSize * 2; x < slitCenterX - slitSize; x++) {
                permittivityRow[x] = 1
            }

            for (let x = slitCenterX + slitSize * 2; x > slitCenterX + slitSize; x--) {
                permittivityRow[x] = 1
            }
        }

        materialMap.permittivity.push(permittivityRow)
        materialMap.permeability.push(new Array(simulationSettings.gridSize[0]).fill(1))
    }

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 30000,
        frequency: 3,
        position: [Math.round(slitCenterX), Math.round(simulationSettings.gridSize[1] / 15)]
    }]

    return {
        sourceDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}

export function fiberOptics(simulationSettings: SimulationSettings): SimulatorMap {
    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: simulationSettings.gridSize
    }

    for (let y = 0; y < simulationSettings.gridSize[1]; y++) {
        materialMap.permittivity.push(new Array(simulationSettings.gridSize[0]).fill(1))
        materialMap.permeability.push(new Array(simulationSettings.gridSize[0]).fill(1))
    }

    function getCurvePoint(t: number): [number, number] {
        return [
            Math.round(simulationSettings.gridSize[0] * 0.5 + simulationSettings.gridSize[0] / 5 * 0.5 / (2 * t + 1) * -Math.sin(2 * Math.PI * t)),
            Math.round(simulationSettings.gridSize[1] * (1 / 10 + t * (1 - 2 / 10)))
        ]
    }

    const numPoints = 100
    const thickness = 0.04 / simulationSettings.cellSize
    for (let t = 0; t < numPoints; t++) {
        const pos = getCurvePoint(t / numPoints)

        for (let x = -thickness + pos[0]; x < thickness + pos[0]; x++) {
            for (let y = -thickness + pos[1]; y < thickness + pos[1]; y++) {
                if (x >= 0 && y >= 0 && x < simulationSettings.gridSize[0] && y < simulationSettings.gridSize[1]) {
                    materialMap.permittivity[y][x] = 2
                }
            }
        }
    }

    const endPoint = getCurvePoint(1)

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 8000,
        frequency: 5,
        position: [endPoint[0] - 1, endPoint[1]],
        turnOffTime: 0.5
    }, {
        type: "point",
        amplitude: 8000,
        frequency: 5,
        position: [endPoint[0] + 2, endPoint[1]],
        turnOffTime: 0.5
    },]

    return {
        sourceDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}

export function lens(simulationSettings: SimulationSettings): SimulatorMap {
    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: simulationSettings.gridSize
    }

    const center = [simulationSettings.gridSize[0] * 0.6, simulationSettings.gridSize[1] / 2]

    function isLensPoint(point: [number, number]) {
        const dx = point[0] - center[0]
        const dy = point[1] - center[1]

        return 4 * dx * dx + dy * dy < simulationSettings.gridSize[0] * simulationSettings.gridSize[0] / (10 * 10)
    }

    for (let y = 0; y < simulationSettings.gridSize[1]; y++) {
        materialMap.permittivity.push([])
        materialMap.permeability.push(new Array(simulationSettings.gridSize[0]).fill(1))
        for (let x = 0; x < simulationSettings.gridSize[0]; x++) {
            materialMap.permittivity[y].push(isLensPoint([x, y]) ? 3 : 1)
        }
    }

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 20000,
        frequency: 2,
        position: [Math.round(simulationSettings.gridSize[0] / 10), Math.round(simulationSettings.gridSize[1] / 2)],
        turnOffTime: 0.5
    }]

    return {
        sourceDescriptors: sourceDescriptors,
        simulationSettings: simulationSettings,
        materialMap: materialMap
    }
}