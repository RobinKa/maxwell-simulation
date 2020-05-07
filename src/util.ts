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

export type QualityPreset = {
    dt: number
    cellSize: number
    gridSizeLongest: number
    resolutionScale: number
}

export const qualityPresets: { [presetName: string]: QualityPreset } = {
    "Low": {
        dt: 0.013 * 2,
        cellSize: 0.02 * 2,
        resolutionScale: 0.3,
        gridSizeLongest: 400 / 2
    },
    "Medium": {
        dt: 0.013,
        cellSize: 0.02,
        resolutionScale: 1,
        gridSizeLongest: 400
    },
    "High": {
        dt: 0.013 / 2,
        cellSize: 0.02 / 2,
        resolutionScale: 1,
        gridSizeLongest: 400 * 2
    },
    "Ultra": {
        dt: 0.013 / 4,
        cellSize: 0.02 / 4,
        resolutionScale: 1,
        gridSizeLongest: 400 * 4
    }
}