export function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
    } else if (document.exitFullscreen) {
        document.exitFullscreen()
    }
}

export function clamp(min: number, max: number, value: number) {
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
                clamp(0, 255, 128 + 10*permittivity[y][x]),
                clamp(0, 255, 128 + 10*permeability[y][x]),
                clamp(0, 255, 128 + 10*conductivity[y][x]),
            ])
        }

        material.push(row)
    }

    return material
}

export type QualityPreset = {
    dt: number
    cellSize: number
    gridSizeLongest: number
    resolutionScale: number
}