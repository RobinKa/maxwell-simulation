export enum DrawShape {
    Square = "square",
    Ellipse = "ellipse",
}

type BaseDrawInfo = {
    drawShape: DrawShape
    center: [number, number]
    value: number
}

type DrawSquareInfo = {
    drawShape: DrawShape.Square
    halfSize: [number, number]
} & BaseDrawInfo

type DrawCircleInfo = {
    drawShape: DrawShape.Ellipse
    radius: [number, number]
} & BaseDrawInfo

export function makeDrawSquareInfo(center: [number, number], halfSize: [number, number], value: number): DrawSquareInfo {
    return {
        drawShape: DrawShape.Square,
        center,
        halfSize: halfSize,
        value
    }
}

export function makeDrawEllipseInfo(center: [number, number], radius: [number, number], value: number): DrawCircleInfo {
    return {
        drawShape: DrawShape.Ellipse,
        center,
        radius,
        value
    }
}

export type DrawInfo = DrawSquareInfo | DrawCircleInfo