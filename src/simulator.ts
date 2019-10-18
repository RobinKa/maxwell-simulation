import { GPU, IKernelRunShortcut } from "gpu.js"

export type Field3D<T> = T[][][]
export type ScalarField3D = Field3D<number>

export function makeField3D<T>(shape: [number, number, number], getValue: (coords: [number, number, number]) => T): Field3D<T> {
    const field = []
    for (let x = 0; x < shape[0]; x++) {
        const row = []
        for (let y = 0; y < shape[1]; y++) {
            const d = []
            for (let z = 0; z < shape[2]; z++) {
                d.push(getValue([x, y, z]))
            }
            row.push(d)
        }
        field.push(row)
    }
    return field
}

export type SimulationData = {
    time: number
    electricFieldX: ScalarField3D
    electricFieldY: ScalarField3D
    electricFieldZ: ScalarField3D
    magneticFieldX: ScalarField3D
    magneticFieldY: ScalarField3D
    magneticFieldZ: ScalarField3D
    permittivity: ScalarField3D
    permeability: ScalarField3D
}

export interface Simulator {
    stepElectric: (dt: number) => void
    stepMagnetic: (dt: number) => void
    getData: () => SimulationData
}

function reverse<T>(x: T[]) {
    const y = []
    for (let i = x.length - 1; i >= 0; i--) {
        y.push(x[i])
    }
    return y
}

export class FDTDSimulator implements Simulator {
    private data: SimulationData

    private gpu: GPU
    private updateMagneticX: IKernelRunShortcut
    private updateMagneticY: IKernelRunShortcut
    private updateMagneticZ: IKernelRunShortcut
    private updateElectricX: IKernelRunShortcut
    private updateElectricY: IKernelRunShortcut
    private updateElectricZ: IKernelRunShortcut

    constructor(gridSize: [number, number, number], cellSize: number) {
        this.data = {
            time: 0,
            electricFieldX: makeField3D<number>(gridSize, _ => 0),
            electricFieldY: makeField3D<number>(gridSize, _ => 0),
            electricFieldZ: makeField3D<number>(gridSize, _ => 0),
            magneticFieldX: makeField3D<number>(gridSize, _ => 0),
            magneticFieldY: makeField3D<number>(gridSize, _ => 0),
            magneticFieldZ: makeField3D<number>(gridSize, _ => 0),
            permittivity: makeField3D<number>(gridSize, (_) => 0),
            permeability: makeField3D<number>(gridSize, (_) => 0),
        }

        const reverseGridSize = reverse(gridSize)

        this.gpu = new GPU()

        this.updateMagneticX = this.gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D, magFieldX: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const v = y + 1 >= this.output.y! ? 0 : fieldZ[x][y + 1][z]
            //const w = z + 1 >= this.output.x! ? 0 : fieldY[x][y][z + 1]

            // d_Y Z - d_Z Y
            return magFieldX[x][y][z] - dt * ((v - fieldZ[x][y][z]) - (0/*w - fieldY[x][y][z]*/)) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })


        this.updateMagneticY = this.gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D, magFieldY: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const u = x + 1 >= this.output.z! ? 0 : fieldZ[x + 1][y][z]
            //const w = z + 1 >= this.output.x! ? 0 : fieldX[x][y][z + 1]

            // d_Z X - d_X Z
            return magFieldY[x][y][z] - dt * ((0/*w - fieldX[x][y][z]*/) - (u - fieldZ[x][y][z])) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })

        this.updateMagneticZ = this.gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D, magFieldZ: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const u = x + 1 >= this.output.z! ? 0 : fieldY[x + 1][y][z]
            const v = y + 1 >= this.output.y! ? 0 : fieldX[x][y + 1][z]

            // d_X Y - d_Y X
            return magFieldZ[x][y][z] - dt * ((u - fieldY[x][y][z]) - (v - fieldX[x][y][z])) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })

        this.updateElectricX = this.gpu.createKernel(function (fieldY: ScalarField3D, fieldZ: ScalarField3D, elFieldX: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const v = y - 1 < 0 ? 0 : fieldZ[x][y - 1][z]
            //const w = z - 1 < 0 ? 0 : fieldY[x][y][z - 1]

            // d_Y Z - d_Z Y
            return elFieldX[x][y][z] + dt * ((fieldZ[x][y][z] - v) - (0/*fieldY[x][y][z] - w*/)) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })

        this.updateElectricY = this.gpu.createKernel(function (fieldX: ScalarField3D, fieldZ: ScalarField3D, elFieldY: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const u = x - 1 < 0 ? 0 : fieldZ[x - 1][y][z]
            //const w = z - 1 < 0 ? 0 : fieldX[x][y][z - 1]

            // d_Z X - d_X Z
            return elFieldY[x][y][z] + dt * ((0/*fieldX[x][y][z] - w*/) - (fieldZ[x][y][z] - u)) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })

        this.updateElectricZ = this.gpu.createKernel(function (fieldX: ScalarField3D, fieldY: ScalarField3D, elFieldZ: ScalarField3D, dt: number) {
            const x = this.thread.z!
            const y = this.thread.y!
            const z = this.thread.x!

            const u = x - 1 < 0 ? 0 : fieldY[x - 1][y][z]
            const v = y - 1 < 0 ? 0 : fieldX[x][y - 1][z]

            // d_X Y - d_Y X
            return elFieldZ[x][y][z] + dt * ((fieldY[x][y][z] - u) - (fieldX[x][y][z] - v)) / (this.constants.cellSize as number)
        }, { output: reverseGridSize, constants: { cellSize: cellSize } })
    }

    stepElectric = (dt: number) => {
        // d/dt E(x, t) = (curl B(x, t))/(µε)
        this.data.electricFieldX = this.updateElectricX(this.data.magneticFieldY, this.data.magneticFieldZ, this.data.electricFieldX, dt) as ScalarField3D
        this.data.electricFieldY = this.updateElectricY(this.data.magneticFieldX, this.data.magneticFieldZ, this.data.electricFieldY, dt) as ScalarField3D
        this.data.electricFieldZ = this.updateElectricZ(this.data.magneticFieldX, this.data.magneticFieldY, this.data.electricFieldZ, dt) as ScalarField3D

        this.data.time += dt / 2
    }

    stepMagnetic = (dt: number) => {
        // d/dt B(x, t) = -curl E(x, t)
        this.data.magneticFieldX = this.updateMagneticX(this.data.electricFieldY, this.data.electricFieldZ, this.data.magneticFieldX, dt) as ScalarField3D
        this.data.magneticFieldY = this.updateMagneticY(this.data.electricFieldX, this.data.electricFieldZ, this.data.magneticFieldY, dt) as ScalarField3D
        this.data.magneticFieldZ = this.updateMagneticZ(this.data.electricFieldX, this.data.electricFieldY, this.data.magneticFieldZ, dt) as ScalarField3D

        this.data.time += dt / 2
    }

    getData = () => this.data
}