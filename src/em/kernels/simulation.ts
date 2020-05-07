export const updateAlphaBeta = `
    precision highp float;

    uniform sampler2D material;
    uniform float dt;
    uniform float cellSize;

    varying vec2 uv;

    void main() {
        // Get material values
        vec3 mat = texture2D(material, uv).rgb;
        float permeability = mat.x;
        float permittivity = mat.y;
        float conductivity = mat.z;

        // Calculate alpha and beta for electric field
        float cEl = conductivity * dt / (2.0 * permeability);
        float dEl = 1.0 / (1.0 + cEl);
        float alphaEl = (1.0 - cEl) * dEl;
        float betaEl = dt / (permeability * cellSize) * dEl;

        // Calculate alpha and beta for magnetic field
        float cMag = conductivity * dt / (2.0 * permittivity);
        float dMag = 1.0 / (1.0 + cMag);
        float alphaMag = (1.0 - cMag) * dMag;
        float betaMag = dt / (permittivity * cellSize) * dMag;

        gl_FragColor = vec4(alphaEl, betaEl, alphaMag, betaMag);
    }
`

export const updateElectric = `
    precision highp float;

    uniform sampler2D electricField;
    uniform sampler2D magneticField;
    uniform sampler2D alphaBetaField;
    uniform vec2 relativeCellSize;
    uniform bool reflectiveBoundary;

    varying vec2 uv;

    void main() {
        if (!reflectiveBoundary) {
            vec2 b = 2.0 * relativeCellSize;

            float xAtMinBound = uv.x < b.x ? relativeCellSize.x : 0.0;
            float xAtMaxBound = uv.x + b.x >= 1.0 ? -relativeCellSize.x : 0.0;
            float yAtMinBound = uv.y < b.y ? relativeCellSize.y : 0.0;
            float yAtMaxBound = uv.y + b.y >= 1.0 ? -relativeCellSize.y : 0.0;

            if (xAtMinBound != 0.0 || xAtMaxBound != 0.0 || yAtMinBound != 0.0 || yAtMaxBound != 0.0) {
                gl_FragColor = texture2D(electricField, vec2(
                    uv.x + xAtMinBound + xAtMaxBound,
                    uv.y + yAtMinBound + yAtMaxBound
                ));
                return;
            }
        }

        vec2 alphaBeta = texture2D(alphaBetaField, uv).rg;
        
        vec3 el = texture2D(electricField, uv).rgb;
        vec3 mag = texture2D(magneticField, uv).rgb;
        vec3 magXN = texture2D(magneticField, uv - vec2(relativeCellSize.x, 0.0)).rgb;
        vec3 magYN = texture2D(magneticField, uv - vec2(0.0, relativeCellSize.y)).rgb;

        vec3 newEl = vec3(
            // d_Y Z - d_Z Y, but d_Z = 0 in 2d
            alphaBeta.x * el.x + alphaBeta.y * (mag.z - magYN.z),

            // d_Z X - d_X Z, but d_Z = 0 in 2d
            alphaBeta.x * el.y + alphaBeta.y * (magXN.z - mag.z),

            // d_X Y - d_Y X
            alphaBeta.x * el.z + alphaBeta.y * ((mag.y - magXN.y) - (mag.x - magYN.x))
        );

        gl_FragColor = vec4(newEl, 0.0);
    }
`

export const updateMagnetic = `
    precision highp float;

    uniform sampler2D electricField;
    uniform sampler2D magneticField;
    uniform sampler2D alphaBetaField;
    uniform vec2 relativeCellSize;
    uniform bool reflectiveBoundary;

    varying vec2 uv;

    void main() {
        if (!reflectiveBoundary) {
            vec2 b = 2.0 * relativeCellSize;

            float xAtMinBound = uv.x < b.x ? relativeCellSize.x : 0.0;
            float xAtMaxBound = uv.x + b.x >= 1.0 ? -relativeCellSize.x : 0.0;
            float yAtMinBound = uv.y < b.y ? relativeCellSize.y : 0.0;
            float yAtMaxBound = uv.y + b.y >= 1.0 ? -relativeCellSize.y : 0.0;

            if (xAtMinBound != 0.0 || xAtMaxBound != 0.0 || yAtMinBound != 0.0 || yAtMaxBound != 0.0) {
                gl_FragColor = texture2D(magneticField, vec2(
                    uv.x + xAtMinBound + xAtMaxBound,
                    uv.y + yAtMinBound + yAtMaxBound
                ));
                return;
            }
        }

        vec2 alphaBeta = texture2D(alphaBetaField, uv).ba;

        vec3 mag = texture2D(magneticField, uv).rgb;
        vec3 el = texture2D(electricField, uv).rgb;
        vec3 elXP = texture2D(electricField, uv + vec2(relativeCellSize.x, 0.0)).rgb;
        vec3 elYP = texture2D(electricField, uv + vec2(0.0, relativeCellSize.y)).rgb;

        vec3 newMag = vec3(
            // d_Y Z - d_Z Y, but d_Z = 0 in 2d
            alphaBeta.x * mag.x - alphaBeta.y * (elYP.z - el.z),

            // d_Z X - d_X Z, but d_Z = 0 in 2d
            alphaBeta.x * mag.y - alphaBeta.y * (el.z - elXP.z),

            // d_X Y - d_Y X
            alphaBeta.x * mag.z - alphaBeta.y * ((elXP.y - el.y) - (elYP.x - el.x))
        );

        gl_FragColor = vec4(newMag, 0.0);
    }
`

export const injectSource = `
    precision highp float;

    uniform sampler2D sourceField;
    uniform sampler2D field;
    uniform float dt;

    varying vec2 uv;

    void main() {
        vec4 source = texture2D(sourceField, uv);
        vec4 field = texture2D(field, uv);

        gl_FragColor = field + dt * source;
    }
`

export const decaySource = `
    precision highp float;

    uniform sampler2D sourceField;
    uniform float dt;

    varying vec2 uv;

    void main() {
        vec4 source = texture2D(sourceField, uv);
        vec4 decayedSource = source * pow(0.1, dt);

        gl_FragColor = decayedSource;
    }
`

export const drawSquare = `
    precision highp float;

    uniform sampler2D texture;
    uniform vec2 pos;
    uniform vec4 value;
    uniform vec2 size;
    uniform vec4 keep;
    uniform vec2 gridSize;

    varying vec2 uv;

    void main() {
        // Snap to grid. Round up or down correctly.
        vec2 relativeCellSize = 1.0 / gridSize;
        vec2 residual = mod(pos, relativeCellSize);
        vec2 gridPos = pos - residual;
        if (residual.x > 0.5 * relativeCellSize.x) {
            gridPos.x += relativeCellSize.x;
        }
        if (residual.y > 0.5 * relativeCellSize.y) {
            gridPos.y += relativeCellSize.y;
        }

        vec2 d = abs(gridPos.xy - uv.xy);
        vec4 oldValue = texture2D(texture, uv);
        bool within = all(lessThanEqual(d, size));

        gl_FragColor = within ? value + keep * oldValue : oldValue;
    }
`

export const drawCircle = `
    precision highp float;

    uniform sampler2D texture;
    uniform vec2 pos;
    uniform vec4 value;
    uniform vec2 radius;
    uniform vec4 keep;
    uniform vec2 gridSize;

    varying vec2 uv;

    void main() {
        // Snap to grid. Round up or down correctly.
        vec2 relativeCellSize = 1.0 / gridSize;
        vec2 residual = mod(pos, relativeCellSize);
        vec2 gridPos = pos - residual;
        if (residual.x > 0.5 * relativeCellSize.x) {
            gridPos.x += relativeCellSize.x;
        }
        if (residual.y > 0.5 * relativeCellSize.y) {
            gridPos.y += relativeCellSize.y;
        }

        // Calculate distance squared
        vec2 d = gridPos.xy - uv.xy;

        // Check if distance is within ellipse
        d = d / radius;
        d = d * d;

        // In a perfect world we'd just use 1 here to check if the point is within
        // an ellipse. However it seems like half-float accuracies are not good
        // enough when the radius is at its lowest (ie. half a cell size) so use a bigger
        // number for that case.
        float c = radius[0] < 1.0 / gridSize[0] || radius[1] < 1.0 / gridSize[1] ? 2.0 : 1.0;
        bool within = d.x + d.y <= c;
        
        vec4 oldValue = texture2D(texture, uv);

        gl_FragColor = within ? value + keep * oldValue : oldValue;
    }
`

export const vert = `
    precision highp float;
    attribute vec2 position;
    varying vec2 uv;
    void main() {
        uv = 0.5 * (position + 1.0);
        gl_Position = vec4(position, 0, 1);
    }
`

export const copyUint8ToFloat16 = `
    precision highp float;

    uniform sampler2D texture;

    varying vec2 uv;

    void main() {
        gl_FragColor = (-128.0 + 255.0 * texture2D(texture, uv)) / 4.0;
    }
`

export const copyFloat16ToUint8 = `
    precision highp float;

    uniform sampler2D texture;

    varying vec2 uv;

    void main() {
        gl_FragColor = (128.0 + 4.0 * texture2D(texture, uv)) / 256.0;
    }
`