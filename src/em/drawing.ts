export type DrawShapeType = "square" | "circle"

type BaseDrawInfo = {
    drawShape: DrawShapeType
    center: [number, number]
    value: number
}

type DrawSquareInfo = {
    drawShape: "square"
    halfSize: number
} & BaseDrawInfo

type DrawCircleInfo = {
    drawShape: "circle"
    radius: number
} & BaseDrawInfo

export function makeDrawSquareInfo(center: [number, number], halfSize: number, value: number): DrawSquareInfo {
    return {
        drawShape: "square",
        center,
        halfSize: halfSize,
        value
    }
}

export function makeDrawCircleInfo(center: [number, number], radius: number, value: number): DrawCircleInfo {
    return {
        drawShape: "circle",
        center,
        radius,
        value
    }
}

export type DrawInfo = DrawSquareInfo | DrawCircleInfo