const AfkBot = require('./AfkBot') // path to file

const HOST = '10.167.131.135'
const PORT = 25572

const SPACING_MS = 15_000

const botsConfig = [
    { host: HOST, port: PORT, name: 'bot_paper_farm', x: 727.7, y: 92, z: 11.5, world: 'world' },
    { host: HOST, port: PORT, name: 'bot_magma_farm', x: 289.7, y: 253, z: -220, world: 'world_nether' },
]

botsConfig.forEach((cfg, i) => {
  setTimeout(() => new AfkBot(cfg), i * SPACING_MS)
})
