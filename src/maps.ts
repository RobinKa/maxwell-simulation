import { SimulatorMap, MaterialMap, SourceDescriptor, SimulationSettings } from "./serialization"

export function empty(): SimulatorMap {
    const gridSize: [number, number] = [500, 500]
    const materialMapSize: [number, number] = [500, 500]

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: materialMapSize
    }

    for (let y = 0; y < materialMapSize[1]; y++) {
        materialMap.permittivity.push(new Array(materialMapSize[0]).fill(1))
        materialMap.permeability.push(new Array(materialMapSize[0]).fill(1))
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

export function doubleSlit(): SimulatorMap {
    const gridSize: [number, number] = [500, 500]
    const materialMapSize: [number, number] = [500, 500]

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: materialMapSize
    }

    for (let y = 0; y < materialMapSize[1]; y++) {
        const isWallRow = Math.abs(y - materialMapSize[1] / 10) < 2
        const permittivityRow = new Array(materialMapSize[0]).fill(isWallRow ? 100 : 1)

        if (isWallRow) {
            for (let x = materialMapSize[0] / 5 - 10; x < materialMapSize[0] / 5 - 5; x++) {
                permittivityRow[x] = 1
            }

            for (let x = materialMapSize[0] / 5 + 10; x > materialMapSize[0] / 5 + 5; x--) {
                permittivityRow[x] = 1
            }
        }

        materialMap.permittivity.push(permittivityRow)
        materialMap.permeability.push(new Array(materialMapSize[0]).fill(1))
    }

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 2000000,
        frequency: 3,
        position: [Math.round(gridSize[0] / 5), Math.round(gridSize[1] / 15)]
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

export function fiberOptics(): SimulatorMap {
    const gridSize: [number, number] = [500, 500]
    const materialMapSize: [number, number] = [500, 500]

    const materialMap: MaterialMap = {
        permittivity: [],
        permeability: [],
        shape: materialMapSize
    }

    for (let y = 0; y < materialMapSize[1]; y++) {
        materialMap.permittivity.push(new Array(materialMapSize[0]).fill(1))
        materialMap.permeability.push(new Array(materialMapSize[0]).fill(1))
    }

    function getCurvePoint(t: number): [number, number] {
        return [
            Math.round(30 + gridSize[0] / 10 * 0.5 / (2 * t + 1) * (1 + -Math.sin(2 * Math.PI * t))),
            Math.round(30 + t * gridSize[0] / 3)
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

    const sourceDescriptors: SourceDescriptor[] = [{
        type: "point",
        amplitude: 2000000,
        frequency: 3,
        position: getCurvePoint(0),
        turnOffTime: 0.5
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