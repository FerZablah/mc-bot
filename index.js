const AfkBot = require('./AfkBot') // path to file

const HOST = '10.167.131.135'
const PORT = 25572

const botsConfig = [
  { host: HOST, port: PORT, name: 'bot_magma_farm', x: 727.7, y: 92, z: 11.5, world: 'world' },
]

const bots = botsConfig.map(cfg => new AfkBot(cfg))
