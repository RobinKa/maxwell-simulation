export const renderEnergy = `
    precision highp float;

    uniform sampler2D electricField;
    uniform sampler2D magneticField;
    uniform sampler2D material;
    uniform float brightness;
    uniform float electricEnergyFactor;
    uniform float magneticEnergyFactor;

    varying vec2 uv;

    void main() {
        vec3 el = texture2D(electricField, uv).rgb;
        vec3 mag = texture2D(magneticField, uv).rgb;
        vec2 mat = texture2D(material, uv).rg;
        float brightnessSquared = brightness * brightness;

        vec2 energy = vec2(
            electricEnergyFactor * mat.x * dot(el, el),
            magneticEnergyFactor * mat.y * dot(mag, mag)
        );

        gl_FragColor = vec4(brightnessSquared * energy, 0.0, 0.0);
    }
`

export const bloomExtract = `
    precision highp float;

    uniform sampler2D texture;
    uniform float threshold;

    varying vec2 uv;

    void main() {
        vec4 col = texture2D(texture, uv);
        gl_FragColor = col * step(threshold, 0.5 * (col.r + col.g));
    }
`

export const blurDirectional = `
    precision highp float;

    uniform sampler2D texture;
    uniform vec2 direction;

    varying vec2 uv;

    void main() {
        gl_FragColor =
            0.227027 * texture2D(texture, uv) +
            0.1945946 * (texture2D(texture, uv + direction) + texture2D(texture, uv - direction)) +
            0.1216216 * (texture2D(texture, uv + 2.0 * direction) + texture2D(texture, uv - 2.0 * direction)) +
            0.054054 * (texture2D(texture, uv + 3.0 * direction) + texture2D(texture, uv - 3.0 * direction)) +
            0.016216 * (texture2D(texture, uv + 4.0 * direction) + texture2D(texture, uv - 4.0 * direction));
    }
`

export const renderBackground = `
    precision highp float;

    uniform vec2 gridSize;

    varying vec2 uv;

    const float sqrtTwoPi = 2.50662827463;

    void main() {
        vec2 tileFactor = gridSize;

        // Repeat -0.5..+0.5 sawtooth for as many cells as we have
        vec2 dPermittivity = mod(tileFactor * uv, 1.0) - 0.5;
        vec2 dPermeability = mod(tileFactor * uv + 0.5, 1.0) - 0.5;
        vec2 dConductivity = abs(mod(tileFactor * uv, 1.0) - 0.5);

        // Calculate distance to repeating center for each pixel.
        // Values will be in [0, 2 * PI]
        vec2 pCircleDists = sqrtTwoPi * vec2(
            dot(dPermittivity, dPermittivity),
            dot(dPermeability, dPermeability)
        );

        float bgPermittivity = -smoothstep(0.0, 1.0, pCircleDists.x);
        float bgPermeability = -smoothstep(0.0, 1.0, pCircleDists.y);

        gl_FragColor = vec4(
            bgPermittivity,
            bgPermeability,
            dConductivity.x,
            dConductivity.y
        );
    }
`

export const draw = `
    precision highp float;

    uniform sampler2D energyTexture;
    uniform sampler2D bloomTexture;
    uniform sampler2D materialTexture;
    uniform sampler2D backgroundTexture;

    varying vec2 uv;

    const float sqrtTwoPi = 2.50662827463;

    void main() {
        vec2 energy = texture2D(energyTexture, uv).rg;
        vec2 bloom = texture2D(bloomTexture, uv).rg;
        vec3 material = texture2D(materialTexture, uv).rgb;
        vec4 background = texture2D(backgroundTexture, uv);

        vec2 pValues = 2.0 / (1.0 + exp(-0.5 * (material.rg - 1.0))) - 1.0;
        float cValue = material.b / 10.0;

        float bgPermittivity = pValues.x >= 0.1 ? 1.0 + background.r : background.r;
        float bgPermeability = pValues.y >= 0.1 ? 1.0 + background.g : background.g;
        float backgroundConductivity = 0.5 * (cValue >= 0.0 ?
            cValue * smoothstep(0.0, 1.0, background.b) :
            -cValue * smoothstep(0.0, 1.0, background.a)
        );

        gl_FragColor = vec4(
            min(1.0, backgroundConductivity + 0.8 * bgPermittivity * pValues.x + energy.r + bloom.r),
            min(1.0, backgroundConductivity + bloom.r + bloom.g),
            min(1.0, backgroundConductivity + 0.8 * bgPermeability * pValues.y + energy.g + bloom.g),
            1.0
        );
    }
`

export const vertDraw = `
    precision highp float;
    attribute vec2 position;
    varying vec2 uv;
    void main() {
        uv = 0.5 * (position + 1.0);
        gl_Position = vec4(position, 0, 1);
    }
`