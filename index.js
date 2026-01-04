const { ensureBotWhitelisted } = require("./whitelistBot.js")
const AfkBot = require('./AfkBot') // path to file

const HOST = '10.167.131.135'
const PORT = 25572

const SPACING_MS = 15_000


const serverConfig = {
  winHost: HOST, // home Paper ZeroTier IP
  winUser: "belico",         // or whatever Windows user you enable for SSH/SFTP
  winPrivateKeyPath: "/home/yourlinuxuser/.ssh/mc_whitelist_key",
  whitelistPath: "C:/Users/belico/Desktop/mcss_win-x86-64_v13.9.2/servers/BelicosMinecraftServerPaper/whitelist.json",

  rconHost: HOST,
  rconPort: 25575,
  rconPassword: process.env.RCON_PASSWORD,
};

const botsConfig = [
  { host: HOST, port: PORT, name: 'Don_Juan', x: 727.7, y: 92, z: 11.5, world: 'world' },
  { host: HOST, port: PORT, name: 'Don_Miguel', x: -135.3, y: 95, z: -627.3, world: 'world' },
  { host: HOST, port: PORT, name: 'Joaquin', x: 279.3, y: 251, z: -66.6, world: 'world_nether' },
]


try {
  // for (let i = 0; i < botsConfig.length; i++) {
  //   const bot = botsConfig[i];
  //   //const res = await ensureBotWhitelisted(bot.name, LIVE);
  //   console.log(res); // { botName, uuid, changed, reloaded }
  // }
  botsConfig.forEach((cfg, i) => {
    setTimeout(() => new AfkBot(cfg), i * SPACING_MS)
  })

} catch (error) {
  console.error('Error ', error);
}
