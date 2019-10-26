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