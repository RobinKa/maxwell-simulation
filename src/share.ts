import { EncodedSimulatorMap, decodeSimulatorMap, SimulatorMap, encodeSimulatorMap } from "./em/serialization"

const apiUrl = "https://6xuthl3lv4.execute-api.us-east-1.amazonaws.com/live/share"

export async function getSharedSimulatorMap(shareId: string): Promise<SimulatorMap> {
    const response = await fetch(`${apiUrl}?shareId=${shareId}`)

    if (response.ok) {
        const responseText = await response.text()

        if (responseText) {
            const encodedSimulatorMap = JSON.parse(responseText) as EncodedSimulatorMap
            return decodeSimulatorMap(encodedSimulatorMap)
        }
    }

    throw new Error("Invalid share")
}

export async function shareSimulatorMap(simulatorMap: SimulatorMap): Promise<string> {
    const encodedSimulatorMap = encodeSimulatorMap(simulatorMap)

    const response = await fetch(apiUrl, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encodedSimulatorMap: JSON.stringify(encodedSimulatorMap) })
    })

    if (response.ok) {
        const responseObject = await response.json()
        if (responseObject && responseObject.body) {
            const { shareId } = JSON.parse(responseObject.body)
            if (shareId) {
                return shareId
            }
        }
    }

    throw new Error("Failed share upload")
}